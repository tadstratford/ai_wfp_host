import { aggregator } from "../../mcp/aggregator";
import { setAllScopes } from "../../mcp/scope";
import { setAppHook, setSessionDatabaseId, setSessionId } from "../../mcp/servers/app-wfp-sessions";
import { setBuildContext } from "../../mcp/servers/app-wfp-build";
import { setRunDepth, setRunSessionId } from "@workflow/runContext";
import { callProvider } from "@backend/core/llm/providers";
import type { ProviderMessage, ProviderToolSchema } from "@backend/core/llm/providers";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { runStreamRuleAudit } from "@backend/core/knowledge/classifierAudit";
import { loadRules } from "../../rules/loader";
import { getSession, updateSession, saveSession } from "@backend/core/session/sessions/session_all";
import { summarizeJudgeResult } from "@backend/core/session/judgeSummary";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { setParameterValue, getParameterValue, getParameterMetaValue, resolveTemplates } from "@backend/core/settings/parameterHelpers";
import { getSystemSkillNames } from "./getSkillsPrompt";
import { route, type RouteDecision } from "./skillRouter";
import { getToolParams, type ToolParam } from "../extract/schema";
import { extractParams } from "../extract/extract";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { toolsForCapability, toolNamesWhere, isReportTool } from "../../capabilities/registry";
import { runLoop, mcpToolsToProvider } from "./loop";
import type { LoopResult } from "./loop";
import { getPlanner, synthesizeStructuredArgs, resolveDataName } from "../plan";
import type { NodePlan, PlanResult, AnalysisBreadcrumb } from "../plan";
import { llmPlanner } from "../plan/llm";
import { buildClarifyQuestion, persistClarifiedParams } from "../plan/clarify";
import { executePlanInSession } from "@backend/core/workflow";
import { buildSystemPrompt } from "./prompts";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import type { MetaData } from "wfp-api";
import type { AddMessageArgs } from "@backend/types/chat";

export interface OrchestratorIO {
  databaseId: string;
  userId: string;
  sessionId: string;
  workflowId?: string;
  addMessage: (msg: AddMessageArgs) => Promise<void>;
  addError: (title: string, detail?: string) => Promise<void>;
  mode: string;
}

interface ResumeSnapshot {
  mode: string;
  system: string;
  toolSchemas: ProviderToolSchema[];
  messages: ProviderMessage[];
}

const GUARDRAILS_SKILL = "guardrails";

async function persistResume(
  snapshot: ResumeSnapshot,
  databaseId: string,
  sessionId: string,
): Promise<void> {
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    const metadata = { ...(fresh.metadata ?? {}), pendingResume: snapshot };
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] Failed to persist resume state:", err.message);
  }
}

/** Extract the ordered (tool, args) pairs from a loop transcript. */
function extractToolCalls(messages: ProviderMessage[]): { tool: string; args: Record<string, unknown> }[] {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "tool_use") {
        calls.push({ tool: block.name, args: block.input ?? {} });
      }
    }
  }
  return calls;
}

/** Truncate a value to a safe size for session persistence. */
function safeStringify(v: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(v ?? {});
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return String(v ?? "");
  }
}

/** Durable tool-call args are preserved in full so "save as workflow" can replay
 *  them faithfully. LLM-generated tool args are bounded by the provider's max
 *  output tokens (~32KB), so this stays small; the cap is defensive only. */
const DURABLE_ARG_MAX = 1_000_000;

/** Append this turn's tool calls to the session's durable record (for "save as workflow"). */
async function persistToolCalls(
  databaseId: string,
  sessionId: string,
  calls: { tool: string; args: Record<string, unknown> }[],
): Promise<void> {
  if (calls.length === 0) return;
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    const metadata = (fresh.metadata ?? {}) as any;
    const prev = Array.isArray(metadata.toolCalls) ? metadata.toolCalls : [];
    const tools = calls.map((c) => {
      const durable = isDurableTool(c.tool);
      return {
        tool: c.tool,
        args: safeStringify(c.args, durable ? DURABLE_ARG_MAX : 4000),
        wf_indicator: durable,
      };
    });
    metadata.toolCalls = [...prev, { at: new Date().toISOString(), tools }];
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] Failed to persist tool calls:", err.message);
  }
}

async function persistActiveSkills(
  databaseId: string,
  sessionId: string,
  skills: string[],
): Promise<void> {
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    const metadata = { ...(fresh.metadata ?? {}), lastActiveSkills: skills };
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] Failed to persist active skills:", err.message);
  }
}

interface LastRequest {
  tool: string;
  params: Record<string, unknown>;
  rawMessage: string;
}

async function persistLastRequest(
  databaseId: string,
  sessionId: string,
  lastRequest: LastRequest,
): Promise<void> {
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    const metadata = { ...(fresh.metadata ?? {}), lastRequest };
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] Failed to persist last request:", err.message);
  }
}

export async function clearResume(databaseId: string, sessionId: string): Promise<void> {
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh || !fresh.metadata || fresh.metadata.pendingResume === undefined) return;
    const metadata = { ...fresh.metadata };
    delete metadata.pendingResume;
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] Failed to clear resume state:", err.message);
  }
}

/** Bound the persisted transcript: keep the first user message plus the last `max` messages,
 *  cutting at an assistant boundary so tool_use/tool_result pairs stay intact. */
function trimTranscript(messages: ProviderMessage[], max = 24): ProviderMessage[] {
  if (messages.length <= max) return messages;
  const target = messages.length - max;
  let cut = -1;
  for (let i = 1; i <= target; i++) {
    if (messages[i].role === "assistant") cut = i;
  }
  if (cut === -1) cut = target;
  return [messages[0], ...messages.slice(cut)];
}

const MAX_LOOP_PASS = 20;  // tool calls per runLoop pass
const MAX_LOOP_TOTAL = 25; // hard safety cap across auto-continue passes

// ── Continuation detection ─────────────────────────────────────────────────
// Jev confidently assigns a skill to every utterance, which would otherwise
// starve the follow-up/resume path. Short continuation phrases ("continue",
// "go ahead", …) are detected deterministically before routing so a follow-up
// resumes the pending loop state or re-runs the last real request.

const CONTINUATION_PHRASES = new Set([
  "continue", "go", "go on", "go ahead", "proceed",
  "please continue", "please proceed", "please go ahead",
  "ok", "okay", "yes", "yeah", "yep", "confirm",
  "do it", "run it", "next",
]);

function isContinuation(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (t.split(/\s+/).length > 3) return false;
  return CONTINUATION_PHRASES.has(t);
}

function lastSubstantiveRequest(
  messages: any[] | undefined,
  current: string,
): string | null {
  if (!Array.isArray(messages)) return null;
  const cur = current.trim();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = (m.markdown || "").trim();
    if (text && text !== cur && !isContinuation(text)) return text;
  }
  return null;
}

/** True when a short message references the previous turn's result (a follow-up),
 *  rather than starting a fresh request. Back-reference signals + a length cap
 *  guard against swallowing unrelated short requests. */
function isFollowUp(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t.split(/\s+/).filter(Boolean).length > 10) return false;
  if (t.startsWith("/")) return false;
  return /\b(it|that|this|these|those|the same|instead|also|now|what about|how about|by |per |break|split)\b/.test(
    t,
  );
}

/** True when a message is an explicit write approval. */
function isApproval(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  return [
    "approve", "approved", "confirm", "confirmed", "yes", "yep", "yeah",
    "go ahead", "proceed", "do it", "post it",
  ].includes(t);
}

/** True when a short message asks to save the prior turn's result to data
 *  ("save to data", "save this to data", …), as opposed to a fresh request that
 *  names a new subject ("save the balance sheet to data"). */
function isSaveToDataFollowUp(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;
  if (!/\bsave\b/.test(t) || !/\bdata\b/.test(t)) return false;
  const backRef = /\b(it|this|that|these|those|the\s+(report|data|result|above|prior|previous|output|file))\b/.test(t);
  return backRef || words.length <= 3;
}

/** The workspace data entry the most recent turn persisted (a report `save_to`
 *  arg or a `save_data` step), if any. */
function lastSavedDataName(metadata: any): string | null {
  const calls = Array.isArray(metadata?.toolCalls) ? metadata.toolCalls : [];
  for (let i = calls.length - 1; i >= 0; i--) {
    const tools = calls[i]?.tools;
    if (!Array.isArray(tools)) continue;
    for (const rec of tools) {
      let args: any = rec?.args;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { continue; }
      }
      if (!args || typeof args !== "object") continue;
      if (rec.tool === "save_data" && typeof args.name === "string" && args.name) {
        return args.name.startsWith("staging_") ? args.name : `chat_${args.name}`;
      }
      if (typeof args.save_to === "string" && args.save_to) {
        return args.save_to;
      }
    }
  }
  return null;
}

// ── Write detection (deterministic backstop to Jev's `mutating`) ─────────────
// Jev's `mutating` Noul is advisory and can under-score requests that produce a
// file/report ("make a test report"). These deterministic signals complement it:
// a write-intent verb, or a routed tool that writes/sends.

const WRITE_INTENT_RE =
  /\b(save|create|delete|remove|send|email|post|update|modify|edit|write|export|download|upload|publish|generate|produce|make)\b/i;

const WRITE_TOOLS = new Set([
  ...toolNamesWhere((t) => t.mutating === true),
  "chat_download",
]);

// Tools whose invocation is a durable, reusable workflow step (the "product"),
// as opposed to ephemeral exploration/reads/presentation. Recorded per tool
// call as `wf_indicator` so "save as workflow" extracts the workflow live
// instead of reverse-engineering which steps were durable.
const DURABLE_TOOLS = new Set([
  ...toolNamesWhere((t) => t.durable === true),
  "chat_download",
]);

function isDurableTool(tool: string): boolean {
  return DURABLE_TOOLS.has(tool);
}

function looksMutating(raw: string): boolean {
  return WRITE_INTENT_RE.test(raw);
}

/** True for informational "how do I / how to / what is / explain…" phrasing.
 *  These are questions about how the product works, not requests to perform
 *  the action — they must not trip the write-approval gate. */
function isInformationalQuestion(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return /^(how\s+(do|to|can|should|would|does|is|are)\b|what\s+(is|are|does|do|would|should)\b|why\b|where\b|when\b|who\b|explain\b|tell\s+me\s+(how|about)\b)/.test(t);
}

/** True when the request asks for a QBO financial statement (P&L / income
 *  statement / balance sheet). These must reach the plan path so an unresolved
 *  "as of" date is asked for, instead of being hijacked by a no-arg read
 *  fast-path (qbo_accounts_list) that has nothing to do with a statement. */
const QBO_STATEMENT_RE =
  /\b(balance\s*sheet|statement\s+of\s+financial\s+position|p&l|pnl|profit\s*&?\s*loss|income\s*statement|income\s+by)\b/i;

function looksQboStatement(raw: string): boolean {
  return QBO_STATEMENT_RE.test(raw);
}

/** True when a message is the loop's own "step limit" notice (not user/model content). */
function isStepLimitMessage(m: ProviderMessage): boolean {
  return (
    m.role === "assistant" &&
    typeof m.content === "string" &&
    m.content.startsWith("I hit my step limit")
  );
}

async function executeLoop(opts: {
  system: string;
  messages: ProviderMessage[];
  toolSchemas: ProviderToolSchema[];
  io: OrchestratorIO;
  session: any;
}): Promise<LoopResult> {
  let messages = opts.messages;
  let totalIterations = 0;
  let last: LoopResult;
  // Each tool's output is written into session.parameters['result'] (mirrors the
  // workflow's run_MCP node) so {{result}} resolves identically in chat and
  // workflow. The build loop otherwise lacked this convention.

  while (true) {
    last = await runLoop({
      databaseId: opts.io.databaseId,
      sessionId: opts.io.sessionId,
      userId: opts.io.userId,
      mode: opts.io.mode,
      system: opts.system,
      messages,
      toolSchemas: opts.toolSchemas,
      onToolCall: async (name: string, iteration: number) => {
        await opts.io.addMessage({
          markdown: `Step ${totalIterations + iteration} \u00b7 \`${name}\``,
          json: { kind: "step", tool: name, iteration: totalIterations + iteration },
        });
      },
      executeTool: async (name: string, args: Record<string, unknown>) => {
        console.log(
          `[vers_8] Executing tool: ${name}(${JSON.stringify(args).slice(0, 200)})`,
        );
        try {
          const resolvedArgs = resolveTemplates(args, opts.session.parameters, opts.io.databaseId) as Record<string, unknown>;
          const mcpResult = await aggregator.callTool(name, resolvedArgs);
          const full = extractTextContent(mcpResult);

          // Record the step's output as `result` so a following {{result}}
          // resolves to the value, not a store tool's confirmation text.
          let resultValue: unknown = parseToolOutput(full);
          if (name === "set_param") {
            const paramName = typeof resolvedArgs.name === "string" ? resolvedArgs.name : "";
            const stored = getParameterValue(opts.session.parameters, paramName, opts.io.databaseId);
            if (stored !== undefined) resultValue = stored;
          }
          opts.session.parameters = setParameterValue(opts.session.parameters, "result", {
            _meta: { type: "text" },
            data: resultValue,
          });

          if (name === "check_data" || name === "judge_data") {
            const summary = summarizeJudgeResult(name, resultValue);
            if (summary) {
              try {
                const fresh = await getSession(opts.io.databaseId, opts.io.sessionId);
                if (fresh) {
                  const metadata = { ...(fresh.metadata ?? {}), judgeSummary: summary };
                  await updateSession(opts.io.databaseId, opts.io.sessionId, "metadata", metadata);
                }
              } catch (err: any) {
                console.error("[vers_8] Failed to persist judge summary:", err.message);
              }
            }
          }

          return truncateToolResult(full);
        } catch (err: any) {
          console.error(`[vers_8] Tool ${name} error:`, err.message);
          return `Error: ${err.message}`;
        }
      },
      maxIterations: MAX_LOOP_PASS,
    });

    totalIterations += last.iterations;

    // Natural end (model stopped) or the hard safety cap → stop.
    if (!last.hitCap || totalIterations >= MAX_LOOP_TOTAL) {
      break;
    }

    // Auto-continue: resume from the accumulated transcript, dropping the
    // intermediate "step limit" message so the model picks up where it left off.
    messages = last.messages.filter((m) => !isStepLimitMessage(m));

    // Nudge: the model has spent a full pass without finishing — it's almost
    // certainly paging/re-reading instead of aggregating. Tell it to wrap up.
    messages.push({
      role: "user",
      content:
        "You have made many tool calls. Stop exploring — aggregate or summarize " +
        "what you already have (use aggregate_data/set_param/save_data, not more " +
        "get_data paging) and deliver the final answer or report now.",
    });
  }

  return last;
}

async function finishLoop(
  result: LoopResult,
  system: string,
  toolSchemas: ProviderToolSchema[],
  io: OrchestratorIO,
  skills?: string[],
): Promise<void> {
  if (result.reply) {
    await io.addMessage({ markdown: result.reply, json: { kind: "reply", skills } });
  } else if (result.toolCalls.length > 0) {
    await io.addMessage({
      markdown:
        'I stopped before producing a final answer. Say "continue" and I\'ll pick up where I left off.',
      json: { kind: "reply", skills },
    });
  }
  await persistResume(
    {
      mode: io.mode,
      system,
      toolSchemas,
      messages: trimTranscript(result.messages),
    },
    io.databaseId,
    io.sessionId,
  );
  await persistToolCalls(io.databaseId, io.sessionId, extractToolCalls(result.messages));
}

async function resumeFromSnapshot(
  snapshot: ResumeSnapshot,
  rawMessage: string,
  io: OrchestratorIO,
  session: any,
): Promise<void> {
  await io.addMessage({ markdown: "> _Resuming..._", json: { kind: "meta" } });

  const messages: ProviderMessage[] = [
    ...snapshot.messages,
    { role: "user", content: rawMessage },
  ];

  const result = await executeLoop({
    system: snapshot.system,
    messages,
    toolSchemas: snapshot.toolSchemas,
    io,
    session,
  });

  await finishLoop(result, snapshot.system, snapshot.toolSchemas, io);
}

// ── Deterministic fast path (tool-first) ─────────────────────────────────
// When Jev routes a request to a single tool with high confidence and that tool
// is read-only and every required parameter resolves deterministically, execute
// it directly and render the result with one small LLM call. The read-only
// allowlist is a hard gate: a routing mistake can never cause a write. Jev's
// `mutating` signal is informational only.

// Read-only QBO tools — safe to surface to the build loop regardless of which
// skill routed, and safe to fast-path when the classifier is confident. Derived
// from the capability manifest (class "read"); the connection-check and report
// tools are excluded because they aren't plain data reads.
const QBO_READ_TOOLS = toolsForCapability("qbo", ["read"]).filter(
  (n) => n !== "qbo_connect" && !isReportTool(n),
);

// Planning tools — lean budget-vs-actual store (plan_facts + plan_dim), derived
// from the manifest.
const PLANNING_READ_TOOLS = toolsForCapability("planning", ["read"]);
const PLANNING_WRITE_TOOLS = toolsForCapability("planning", ["constructive-write"]);

// Always-available tools — surfaced to the loop regardless of the active skills'
// declared tools. Covers plumbing (show_message/chat_download/params), data
// primitives, rules, QBO reads, and planning tools.
const ALWAYS_AVAILABLE = [
  "show_message", "chat_download", "set_param", "get_param", "save_data",
  "list_data", "get_data", "aggregate_data", "resolve_data_shape", "judge_data",
  "report_table", "report_qbo_pnl", "report_qbo_bs",
  "list_rules", "get_rule",
  "create_rule", "update_rule", "delete_rule",
  "run_workflow",
  ...QBO_READ_TOOLS,
  ...PLANNING_READ_TOOLS,
  ...PLANNING_WRITE_TOOLS,
];

// Composable primitives — the focused roster the Jev plan composer picks from.
// Narrower than ALWAYS_AVAILABLE so the per-step `next_step` choice isn't
// diluted by ~30 irrelevant tools (QBO reads, planning, rules CRUD). The LLM
// build-loop fallback still uses the full ALWAYS_AVAILABLE set.
const COMPOSABLE_PRIMITIVES = [
  "get_data", "list_data", "resolve_data_shape", "aggregate_data", "judge_data",
  "check_data", "save_data", "set_param", "get_param",
  "report_table", "report_qbo_pnl", "report_qbo_bs", "report_plan_variance",
  "chat_download", "show_message",
];

const FAST_PATH_TOOLS = new Set([
  "get_data", "list_data", "aggregate_data",
  "get_email", "get_email_attachment_content", "get_email_attachments", "get_emails",
  "get_rule", "get_workflow", "get_workspace_info", "get_workspace_notes",
  "list_rules", "list_todos", "list_workflows",
  ...QBO_READ_TOOLS,
  ...PLANNING_READ_TOOLS,
]);

const RENDER_SYSTEM_BASE =
  "You are a helpful AI assistant for WorkflowPeople. Render the tool result below as a concise, clear markdown reply for the user. Use a markdown table when the result is tabular. Do not mention that you used a tool.";

/** Render prompt with today's date so relative-date phrases resolve correctly. */
function renderSystem(): string {
  return `Today's date is ${new Date().toISOString().slice(0, 10)}.\n\n${RENDER_SYSTEM_BASE}`;
}

/** Resolve a data-file reference and synthesize structured args for a fast-path
 *  tool. The flat `extractParams` can't fill `name`/`measures`/`group_by`, so
 *  read tools like `aggregate_data` would otherwise always skip the fast path. */
async function fillFastPathArgs(
  toolId: string,
  rawMessage: string,
  values: Record<string, unknown>,
  databaseId: string,
  params: ToolParam[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...values };
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return out;

    const inventory = ws.getDataNames().map((name: string) => ({ name }));

    let resolvedDataName: string | null = null;
    for (const p of params) {
      if (out[p.name] !== undefined) continue;
      if (p.type !== "string") continue;
      if (!/\b(name|data|table|source)\b/.test(p.name)) continue;
      const resolved = resolveDataName(rawMessage, inventory);
      if (resolved) {
        out[p.name] = resolved;
        resolvedDataName = resolved;
      }
    }

    const columns = resolvedDataName
      ? (ws.getDataEntry(resolvedDataName)?.columns ?? [])
      : [];
    const synthesized = synthesizeStructuredArgs(toolId, rawMessage, columns);
    for (const [k, v] of Object.entries(synthesized)) {
      if (out[k] === undefined) out[k] = v;
    }
    console.log(
      `[vers_8] fast-path args ${toolId}: data=${resolvedDataName} ` +
        `columns=${JSON.stringify(columns)} synthesized=${JSON.stringify(synthesized)}`,
    );
  } catch (err: any) {
    console.warn(`[vers_8] fillFastPathArgs error: ${err.message}`);
  }
  return out;
}

async function executeFastPath(
  toolName: string,
  values: Record<string, unknown>,
  rawMessage: string,
  io: OrchestratorIO,
): Promise<boolean> {
  if (io.mode !== "build") return false;
  if (!FAST_PATH_TOOLS.has(toolName)) return false;

  let content: string;
  try {
    const mcpResult = await aggregator.callTool(toolName, values);
    content = extractTextContent(mcpResult);
  } catch (err: any) {
    console.warn(
      `[vers_8] Fast path tool ${toolName} error: ${err.message}`,
    );
    return false;
  }

  await io.addMessage({
    markdown: `> _\`${toolName}\` (fast path)_`,
    json: { tool: toolName, fastPath: true },
  });

  let replyText = "";
  try {
    const reply = await callProvider(
      io.databaseId,
      {
        system: renderSystem(),
        messages: [
          {
            role: "user",
            content: `User request: ${rawMessage}\n\nTool result from ${toolName}:\n${content.slice(0, 24000)}`,
          },
        ],
        maxTokens: 2000,
        temperature: 0.2,
      },
      {
        sessionId: io.sessionId,
        userId: io.userId,
        mode: io.mode,
        phase: "render",
      },
    );
    replyText = reply.text || "";
  } catch (err: any) {
    console.warn(`[vers_8] Fast path render error: ${err.message}`);
  }

  if (replyText) {
    await io.addMessage({ markdown: replyText, json: { kind: "reply", fastPath: true } });
  } else if (content) {
    await io.addMessage({
      markdown: content.slice(0, 4000),
      json: { kind: "reply", fastPath: true, raw: true },
    });
  }

  await persistLastRequest(io.databaseId, io.sessionId, {
    tool: toolName,
    params: values,
    rawMessage,
  });
  return true;
}

/** Render a concise natural-language summary after a composed plan runs — the
 *  plan path streams raw tool output but never closes with a clean answer. */
async function renderPlanSummary(
  io: OrchestratorIO,
  rawMessage: string,
  plan: { steps: { tool_id: string }[] },
  content: string,
): Promise<void> {
  if (!content.trim()) return;

  try {
    const reply = await callProvider(
      io.databaseId,
      {
        system: renderSystem(),
        messages: [
          {
            role: "user",
            content:
              `User request: ${rawMessage}\n\n` +
              `Plan: ${plan.steps.map((s) => s.tool_id).join(" → ")}\n\n` +
              `Step results:\n${content.slice(0, 24000)}`,
          },
        ],
        maxTokens: 2000,
        temperature: 0.2,
      },
      { sessionId: io.sessionId, userId: io.userId, mode: io.mode, phase: "render" },
    );
    if (reply.text) {
      await io.addMessage({ markdown: reply.text, json: { kind: "reply", planPath: true } });
    }
  } catch (err: any) {
    console.warn(`[vers_8] Plan render error: ${err.message}`);
  }
}

/** Execute a validated plan inline, then summarize + audit. Shared by the normal
 *  plan path and the write-approval resume (which executes a stored plan). */
async function runPlan(
  io: OrchestratorIO,
  session: any,
  rawMessage: string,
  plan: NodePlan,
  selectedSkills: string[],
): Promise<void> {
  const skillNames = selectedSkills.join(", ");
  await io.addMessage({ markdown: `> _Running ${skillNames}..._`, json: { kind: "meta" } });
  const messagesBefore = (session?.messages ?? []).length;
  await executePlanInSession(io.databaseId, session, plan);
  const stream = ((session?.messages ?? []) as any[])
    .slice(messagesBefore)
    .map((m) => (typeof m.markdown === "string" ? m.markdown : ""))
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
  // A report-delivering plan already closes with a Download button — skip the
  // prose summary so the renderer doesn't hallucinate a second, generic report.
  const lastTool = plan.steps[plan.steps.length - 1]?.tool_id;
  if (lastTool !== "chat_download") {
    await renderPlanSummary(io, rawMessage, plan, stream);
  }
  await auditChatPlan(io, stream);
  await persistToolCalls(
    io.databaseId,
    io.sessionId,
    plan.steps.map((s) => ({ tool: s.tool_id, args: s.tool_parameters })),
  );
  await recordAnalysis(io.databaseId, io.sessionId, rawMessage, plan);
}

/** Record a rolling breadcrumb of the just-run plan so follow-ups can reuse its
 *  data source + saved summary (instead of re-picking and re-aggregating). */
async function recordAnalysis(
  databaseId: string,
  sessionId: string,
  rawMessage: string,
  plan: NodePlan,
): Promise<void> {
  let source: string | undefined;
  let savedSummary: string | undefined;
  let groupBy: string[] | undefined;
  for (const s of plan.steps) {
    const name = typeof s.tool_parameters?.name === "string" ? s.tool_parameters.name : undefined;
    const gb = s.tool_parameters?.group_by;
    if (s.tool_id === "aggregate_data" && Array.isArray(gb)) {
      groupBy = gb.filter((x) => typeof x === "string");
    }
    if (s.tool_id === "save_data" && name) {
      savedSummary = name;
    } else if (!source && name && !name.startsWith("{{")) {
      source = name;
    }
  }
  if (!source && !savedSummary) return;
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    const metadata = { ...(fresh.metadata ?? {}) } as any;
    const prev = Array.isArray(metadata.analysisHistory) ? metadata.analysisHistory : [];
    metadata.analysisHistory = [
      { rawMessage, source: source ?? "", savedSummary, groupBy, at: new Date().toISOString() },
      ...prev,
    ].slice(0, 5);
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_8] recordAnalysis failed:", err.message);
  }
}

const AUDIT_STATUS_LABELS: Record<string, string> = {
  no_errors: "Plan ran with no Errors",
  broke_workspace_rule: "Plan broke a Workspace rule",
  broke_presented_rule: "Plan broke a presented rule",
  audit_unavailable: "Plan audit could not run (no classifier key)",
};

/** Fail-closed rule audit for a chat-composed plan — checks the run stream
 *  against the workspace rules (`wfp.rules`) with a single Jev call, exactly
 *  like the terminal `workflow_audit` step of a built workflow. App skills
 *  (guardrails, etc.) are enforced upstream by the write gate + system prompt,
 *  so the audit targets the user's own rules. */
async function auditChatPlan(io: OrchestratorIO, stream: string): Promise<void> {
  const workspaceRules = loadRules(io.databaseId);
  if (workspaceRules.length === 0) return;

  let classifierKey: string;
  try {
    classifierKey = await getClassifierKey(io.userId);
  } catch {
    await io.addMessage({
      markdown: `FAILED AUDIT — ${AUDIT_STATUS_LABELS.audit_unavailable}`,
      json: {
        workflowAudit: {
          statusReason: "audit_unavailable",
          statusLabel: AUDIT_STATUS_LABELS.audit_unavailable,
          failedRule: null,
        },
      },
    });
    return;
  }

  const report = await runStreamRuleAudit({
    workspaceRules,
    presentedRules: "",
    stream,
    apiKey: classifierKey,
  });

  const label = AUDIT_STATUS_LABELS[report.statusReason];
  const failedSuffix = report.failedRule ? ` (${report.failedRule})` : "";
  await io.addMessage({
    markdown:
      report.statusReason === "no_errors"
        ? `✓ ${label}`
        : `FAILED AUDIT — ${label}${failedSuffix}`,
    json: {
      workflowAudit: {
        auditId: Date.now().toString(),
        statusReason: report.statusReason,
        statusLabel: label,
        failedRule: report.failedRule,
        model: report.model,
      },
    },
  });
}

/** Re-run the last fast-path tool with re-extracted params, when the follow-up
 *  contributes at least one resolvable parameter and all required params remain
 *  satisfied. Returns true when it handled the request. */
async function tryFollowUpCarryForward(
  lastReq: LastRequest | undefined,
  rawMessage: string,
  io: OrchestratorIO,
): Promise<boolean> {
  if (!lastReq?.tool) return false;
  const params = await getToolParams(lastReq.tool);
  const extraction = extractParams(lastReq.tool, rawMessage, params);
  const extractedAny = extraction.params.some((p) => p.source === "extracted");
  if (!extractedAny) return false;

  const merged = { ...lastReq.params };
  for (const p of extraction.params) {
    if (p.source !== "missing") merged[p.name] = p.value;
  }
  const stillMissing = params
    .filter((p) => p.required && merged[p.name] === undefined)
    .map((p) => p.name);
  if (stillMissing.length > 0) return false;

  console.log(
    `[vers_8] Follow-up → re-running ${lastReq.tool} with ${JSON.stringify(merged)}`,
  );
  await executeFastPath(lastReq.tool, merged, rawMessage, io);
  return true;
}

export async function processUserMessage(
  rawMessage: string,
  session: any,
  io: OrchestratorIO,
): Promise<void> {
  // Set databaseId on every capability (fan-out driven by the registry).
  setAllScopes(io.databaseId);
  // Context-bound (non-capability) servers: sessions needs sessionId + appHook,
  // build needs userId/sessionId.
  setSessionDatabaseId(io.databaseId);
  setSessionId(io.sessionId);
  setRunDepth(0);
  setRunSessionId(io.sessionId);
  setBuildContext({ databaseId: io.databaseId, userId: io.userId, sessionId: io.sessionId });
  setAppHook({
    addMessage: async (msg) => {
      await io.addMessage(msg);
    },
    setParameter: (name: string, value: unknown, meta?: MetaData) => {
      session.parameters = setParameterValue(session.parameters, name, {
        _meta: meta ?? { type: "string" },
        data: value,
      });
      saveSession(io.databaseId, session).catch(() => {});
    },
    getParameter: (name: string) => {
      return getParameterValue(session.parameters, name, io.databaseId);
    },
    getParameterMeta: (name: string) => {
      return getParameterMetaValue(session.parameters, name, io.databaseId);
    },
  });

  // ── Write-approval gate ─────────────────────────────────────────────
  // On approval, either execute the already-composed plan (stored during the
  // write gate) or re-run the request with writeApproved set (loop path).
  const meta = (session?.metadata as any) ?? {};
  if (meta.pendingWrite && isApproval(rawMessage)) {
    const pending = meta.pendingWrite as {
      rawMessage: string;
      plan: NodePlan | null;
      skills: string[];
    };
    if (pending.plan) {
      // Plan path — execute the already-composed plan directly (no re-compose).
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...meta,
        pendingWrite: undefined,
        writeApproved: false,
      });
      const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
      console.log("[vers_8] Write approved → executing stored plan");
      await runPlan(io, fresh, pending.rawMessage, pending.plan, pending.skills);
    } else {
      // Loop path — re-run with writeApproved so the loop may proceed.
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...meta,
        pendingWrite: undefined,
        writeApproved: true,
      });
      const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
      console.log(
        `[vers_8] Write approved → re-running: ${pending.rawMessage.slice(0, 80)}`,
      );
      await processUserMessage(pending.rawMessage, fresh, io);
    }
    return;
  }

  // ── Clarification resume ─────────────────────────────────────────────
  // A stored "ask the user" clarification is answered by re-running the original
  // request with the user's reply appended. The reply is also resolved into
  // typed parameters (stored in session.parameters, workflow-style) so the
  // re-run can consume them by name rather than only re-parsing free text.
  if (meta.pendingClarification) {
    const pending = meta.pendingClarification as {
      rawMessage: string;
      question: string;
      missing?: string[];
    };
    const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
    const clarified = await persistClarifiedParams(
      fresh,
      pending.missing ?? [],
      rawMessage,
    );
    // Clear the pending flag and hand the resolved values to the re-run (typed
    // params are already stored in fresh.parameters by persistClarifiedParams).
    const freshMeta = { ...((fresh?.metadata as any) ?? {}), pendingClarification: undefined };
    if (Object.keys(clarified).length > 0) {
      freshMeta.clarifiedParams = clarified;
    }
    fresh.metadata = freshMeta;
    await saveSession(io.databaseId, fresh);
    const combined = `${pending.rawMessage}\n${rawMessage.trim()}`;
    console.log(
      `[vers_8] Clarification answered → re-running: ${combined.slice(0, 120)}`,
    );
    await processUserMessage(combined, fresh, io);
    return;
  }

  // ── Continuation gate ───────────────────────────────────────────────
  // A short follow-up ("continue", "go ahead", …) should resume the pending
  // loop state or re-run the last real request — not be routed as a new task.
  const pendingResume = (session?.metadata as any)?.pendingResume as
    | ResumeSnapshot
    | undefined;

  if (isContinuation(rawMessage)) {
    if (pendingResume && pendingResume.mode === io.mode) {
      await resumeFromSnapshot(pendingResume, rawMessage, io, session);
      return;
    }
    const last = lastSubstantiveRequest(session?.messages, rawMessage);
    if (last) {
      console.log(`[vers_8] Continuation → re-running: ${last.slice(0, 80)}`);
      await processUserMessage(last, session, io);
      return;
    }
  }

  // ── Follow-up gate (heuristic) ───────────────────────────────────────
  // A short message that references the previous result ("can i see it by
  // month") re-runs the last fast-path tool with re-extracted parameters,
  // instead of being routed as a fresh request.
  const lastReq = (session?.metadata as any)?.lastRequest as
    | LastRequest
    | undefined;

  if (
    isFollowUp(rawMessage) &&
    (await tryFollowUpCarryForward(lastReq, rawMessage, io))
  ) {
    return;
  }

  // ── "save to data" follow-up gate ────────────────────────────────────
  // "save this/that/it to data" references the prior turn's output. If that turn
  // already persisted it (report save_to / save_data), confirm the name instead
  // of routing to data-handling (which would ask "which data?").
  if (isSaveToDataFollowUp(rawMessage)) {
    const savedName = lastSavedDataName(session?.metadata);
    const ws = savedName ? getSessionByDatabaseId(io.databaseId) : null;
    if (savedName && ws?.getDataEntry(savedName)) {
      await io.addMessage({
        markdown: `Already saved as \`${savedName}\` — it's on the Data page and readable via \`get_data\` / \`list_data\`.`,
        json: { kind: "reply", savedData: savedName },
      });
      console.log(
        `[vers_8] "save to data" follow-up → already saved as ${savedName}`,
      );
      return;
    }
  }

  // ── Phase 1: Jev routing (skill + tool + gates) ─────────────────────
  // One batched structured-decision call classifies the whole request.
  await ensureEnabledSkillGroups(io.databaseId);

  let decision: RouteDecision;
  try {
    decision = await route(io.databaseId, io.userId, rawMessage, {
      lastRequest: lastReq,
      lastTool: lastReq?.tool,
      activeSkills: (session?.metadata as any)?.lastActiveSkills,
      sessionId: io.sessionId,
      mode: io.mode,
    });
  } catch (err: any) {
    console.error("[vers_8] Routing failed:", err.message);
    await io.addError("Rules routing failed", err.message);
    return;
  }

  // ── Follow-up gate (Jev-judged) ──────────────────────────────────────
  // Jev's follow_up signal catches follow-ups the heuristic missed (e.g.
  // longer rephrasings). Same carry-forward as the heuristic gate.
  if (
    decision.followUp >= 0.6 &&
    (await tryFollowUpCarryForward(lastReq, rawMessage, io))
  ) {
    return;
  }

  const allSkillNames = getSystemSkillNames(io.databaseId);
  const routedSkills = decision.selectedSkills.filter((name: string) =>
    allSkillNames.includes(name),
  );

  // Always-on safety skill — attached to every request regardless of routing.
  // Email mode uses a bounded autonomous policy instead of confirm-before-write,
  // and always includes email-processing so inbound mail is routed to a workflow
  // (via list_workflows / run_workflow) rather than handled free-form.
  const alwaysOn = io.mode === "email"
    ? ["email-guardrails", "email-processing"]
    : [GUARDRAILS_SKILL];
  const selectedSkills: string[] = Array.from(
    new Set([...routedSkills, ...alwaysOn]),
  );

  await persistActiveSkills(io.databaseId, io.sessionId, selectedSkills);

  // ── Step 2: tools follow skills (deterministic) ─────────────────────
  // The capability index is the startup-built "skills + tools" JSON object;
  // the selected skills' declared tools (deduped) become this request's tool
  // set, looked up from the index rather than re-listed per request.
  const capability = await getCapabilityIndex();
  const declared = new Set<string>();
  for (const skill of selectedSkills) {
    const entry = capability.skills.get(skill);
    if (entry) for (const t of entry.tools) declared.add(t);
  }

  // ── Phase 0: deterministic fast path ────────────────────────────────
  // Confident + read-only + fully-resolved → execute the tool directly. The
  // tool is only accepted when it is declared by the selected skills. There is
  // no Jev tool ranking — scan the declared fast-path tools and run the first
  // whose required params all resolve deterministically.

  const complexityLow =
    !Number.isFinite(decision.complexity) || decision.complexity < 0.5;

  if (decision.needsTool >= 0.5 && complexityLow && !looksQboStatement(rawMessage)) {
    const fastPath = await resolveFastPathTool(declared, rawMessage, io.databaseId);
    if (fastPath) {
      await executeFastPath(fastPath.tool, fastPath.values, rawMessage, io);
      console.log("[vers_8] Fast path handled the request.\n");
      return;
    }
  }

  if (routedSkills.length === 0) {
    // No task skill matched. If a previous turn left a resumable transcript and
    // the user is following up (e.g. confirming a pending action), resume it.
    if (pendingResume && rawMessage.trim() && pendingResume.mode === io.mode) {
      await resumeFromSnapshot(pendingResume, rawMessage, io, session);
    } else {
      await io.addMessage({ markdown: "No matching rules found for this request.", json: { kind: "meta" } });
    }
    console.log("[vers_8] Routing finished (no skills selected).\n");
    return;
  }

  // Durable/repeatable work is now composed and run inline by the plan path
  // below (the former "redirect to Make Workflow" gate is removed).

  await io.addMessage({
    markdown: `**Rules activated:** ${selectedSkills.map((s) => `\`${s}\``).join(", ")}${decision.skillSummary ? ` — Jev: ${decision.skillSummary}` : ""}`,
    json: { kind: "meta" },
  });
  await clearResume(io.databaseId, io.sessionId);

  // ── Write-intent detection ───────────────────────────────────────────
  // Jev flagged the request as mutating (or it clearly writes/produces something).
  // The approval gate itself runs AFTER the plan is shown (see Phase 3), so the
  // user sees the steps before deciding. The read-only fast path already
  // returned above.
  const mutatingRequest =
    !isInformationalQuestion(rawMessage) &&
    (decision.mutating >= 0.5 ||
      looksMutating(rawMessage) ||
      [...declared].some((t) => WRITE_TOOLS.has(t)));

  // ── Phase 2: Build the loop with the skills' declared tools ─────────
  const ROUTING_TOOLS = ["select_skill", "list_skills"];
  const workingTools = [...capability.tools.values()].filter(
    (t) =>
      !ROUTING_TOOLS.includes(t.name) &&
      (declared.has(t.name) || ALWAYS_AVAILABLE.includes(t.name)),
  );

  if (workingTools.length > 0) {
    // (The per-request "Tools selected" dump was removed — it emitted ~40 tool
    // names as process noise with no user value.)

    // ── Phase 3: Plan (swappable planner) → show steps → gate → execute,
    //    with an LLM-loop fallback so the plan path can't regress a request
    //    it can't plan. ──────────────────────────────────────────────────
    // The planner's roster is deliberately narrow (skills' declared tools +
    // composable primitives) so the planner isn't diluted by the full
    // ALWAYS_AVAILABLE surface the LLM loop needs.
    const composeRoster = [...capability.tools.values()]
      .filter(
        (t) =>
          !ROUTING_TOOLS.includes(t.name) &&
          (declared.has(t.name) || COMPOSABLE_PRIMITIVES.includes(t.name)),
      )
      .map((t: any) => ({ name: t.name, description: t.description || "" }));

    let planResult: PlanResult;
    // Clarified values from a prior turn's ask, handed to the planner so it can
    // consume them by name (workflow-style) instead of only re-parsing text.
    const sessionMetaForPlan = (session?.metadata as any) ?? {};
    const clarifiedParams: Record<string, unknown> =
      sessionMetaForPlan.clarifiedParams ?? {};
    if (sessionMetaForPlan.clarifiedParams) {
      delete sessionMetaForPlan.clarifiedParams;
      saveSession(io.databaseId, session).catch(() => {});
    }
    try {
      const planner = getPlanner();
      planResult = await planner.plan({
        databaseId: io.databaseId,
        userId: io.userId,
        rawMessage,
        tools: composeRoster,
        activeSkills: selectedSkills,
        lastRequest: lastReq?.rawMessage,
        analysisHistory: (session?.metadata as any)?.analysisHistory,
        complexity: decision.complexity,
        mutating: decision.mutating,
        clarifiedParams,
      });
    } catch (err: any) {
      console.warn(`[vers_8] Plan path failed (falling back to build loop): ${err.message}`);
      planResult = { kind: "fallback", reason: `planner threw: ${err.message}` };
    }

    // ── Universal LLM planner fallback ─────────────────────────────────
    // When the deterministic templates can't compose the request, ask the LLM
    // planner to produce a plan over the full working roster. This guarantees
    // every request yields a plan to show/approve instead of a plan-less gate.
    if (planResult.kind === "fallback" && !planResult.preferLoop) {
      const workingRoster = workingTools.map((t: any) => ({
        name: t.name,
        description: t.description || "",
      }));
      try {
        planResult = await llmPlanner.plan({
          databaseId: io.databaseId,
          userId: io.userId,
          rawMessage,
          tools: workingRoster,
          activeSkills: selectedSkills,
          lastRequest: lastReq?.rawMessage,
          analysisHistory: (session?.metadata as any)?.analysisHistory,
          complexity: decision.complexity,
          mutating: decision.mutating,
          clarifiedParams,
        });
      } catch (err: any) {
        console.warn(`[vers_8] LLM planner failed: ${err.message}`);
      }
    }

    // ── Clarification gate ─────────────────────────────────────────────
    // A planner couldn't resolve a required argument. Ask the user for it
    // (instead of guessing), store the pending clarification, and end the turn.
    if (planResult.kind === "clarify") {
      const question =
        planResult.question ?? (await buildClarifyQuestion(planResult.missing));
      await io.addMessage({ markdown: question, json: { kind: "reply" } });
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...((session?.metadata as any) ?? {}),
        pendingClarification: { rawMessage, question, missing: planResult.missing },
      });
      console.log(
        `[vers_8] Asking for missing: ${planResult.missing.join(", ")}`,
      );
      return;
    }

    let executed = false;

    if (planResult.kind === "plan" && planResult.plan.steps.length > 0) {
      // Show the steps FIRST, then gate approval (mutating only), then execute —
      // so the user sees where the run is going before approving.
      const stepList = planResult.plan.steps
        .map((s, i) => `${i + 1}. ${s.label || s.tool_id}`)
        .join("\n");
      await io.addMessage({ markdown: `**Steps**\n${stepList}`, json: { kind: "plan" } });

      const wmeta = (session?.metadata as any) ?? {};
      if (io.mode === "build" && mutatingRequest && !wmeta.writeApproved) {
        await io.addMessage({
          markdown: "This request will create, modify, or send data. Use the **Approve** button below to continue, or **Cancel**.",
          json: { approval: true },
        });
        await updateSession(io.databaseId, io.sessionId, "metadata", {
          ...wmeta,
          pendingWrite: { rawMessage, plan: planResult.plan, skills: selectedSkills },
        });
        return;
      }

      await runPlan(io, session, rawMessage, planResult.plan, selectedSkills);
      executed = true;
    }

    if (!executed) {
      // Fallback (LLM loop) has no up-front plan to show — gate before running.
      const wmeta = (session?.metadata as any) ?? {};
      if (io.mode === "build" && mutatingRequest && !wmeta.writeApproved) {
        await io.addMessage({
          markdown: "This request will create, modify, or send data. Use the **Approve** button below to continue, or **Cancel**.",
          json: { approval: true },
        });
        await updateSession(io.databaseId, io.sessionId, "metadata", {
          ...wmeta,
          pendingWrite: { rawMessage, plan: null, skills: selectedSkills },
        });
        return;
      }
      if (wmeta.writeApproved) {
        await updateSession(io.databaseId, io.sessionId, "metadata", {
          ...wmeta,
          writeApproved: false,
        });
      }

      // ── Legacy fallback: LLM build loop ────────────────────────────
      const toolSchemas = mcpToolsToProvider(workingTools);

      const systemPrompt = buildSystemPrompt(
        io.mode,
        toolSchemas,
        io.databaseId,
        selectedSkills,
      );

      let paramHint = "";
      for (const tool of declared) {
        const params = await getToolParams(tool);
        const extraction = extractParams(tool, rawMessage, params);
        const resolved = extraction.params
          .filter((p) => p.source !== "missing")
          .map((p) => `- ${p.name} = ${JSON.stringify(p.value)}`);
        if (resolved.length > 0) {
          paramHint = `\n## Resolved parameters (already extracted, prefer these)\n${resolved.join("\n")}`;
          break;
        }
      }

      const sessionMessages: any[] = session.messages || [];
      const messages: ProviderMessage[] = [];

      const recent = sessionMessages.slice(-12);
      for (const m of recent) {
        if (m.role === "user" || m.role === "assistant") {
          messages.push({
            role: m.role as "user" | "assistant",
            content: (m.markdown || "").slice(0, 2000),
          });
        }
      }

      const lastMsg = messages[messages.length - 1];
      if (
        !lastMsg ||
        lastMsg.role !== "user" ||
        (typeof lastMsg.content === "string" &&
          lastMsg.content.slice(0, 200).trim() !== rawMessage.slice(0, 200).trim())
      ) {
        messages.push({ role: "user", content: rawMessage });
      }

      while (messages.length > 0 && messages[messages.length - 1].role !== "user") {
        messages.pop();
      }
      if (messages.length === 0) {
        messages.push({ role: "user", content: rawMessage });
      }

      if (paramHint) {
        const lastUser = messages[messages.length - 1];
        lastUser.content = `${lastUser.content}\n${paramHint}`;
      }

      console.log(
        `[vers_8] Falling back to build loop with ${toolSchemas.length} tools, ${messages.length} messages`,
      );

      const skillNames = selectedSkills.join(", ");
      await io.addMessage({ markdown: `> _Working with ${skillNames}..._`, json: { kind: "meta" } });

      const result = await executeLoop({
        system: systemPrompt,
        messages,
        toolSchemas,
        io,
        session,
      });

      await finishLoop(result, systemPrompt, toolSchemas, io, routedSkills);
    }
  } else {
    await io.addMessage({ markdown: "No matching tools found for the selected rules.", json: { kind: "meta" } });
  }

  console.log("[vers_8] Pipeline finished.\n");
}

function extractTextContent(mcpResult: any): string {
  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    return mcpResult.content
      .map((c: any) => c.text || "")
      .filter(Boolean)
      .join("\n");
  }
  if (typeof mcpResult === "string") return mcpResult;
  return JSON.stringify(mcpResult);
}

/** Parse a tool's text output into a structured value when it is JSON, so a
 *  following {{result}} resolves to the object rather than a JSON string —
 *  matching the workflow run_MCP node's behavior. */
function parseToolOutput(text: string): unknown {
  if (!text) return text;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
}

/** Cap the tool output fed back into the LLM's context. The full output is
 *  written to session.parameters['result'] so a following
 *  `chat_download(data="{{result}}")` still receives the complete artifact;
 *  the model only needs enough to know what happened. */
const MAX_TOOL_RESULT_CHARS = 12000;

function truncateToolResult(full: string): string {
  if (full.length <= MAX_TOOL_RESULT_CHARS) return full;
  return (
    full.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n\n[output truncated at ${MAX_TOOL_RESULT_CHARS} chars — reference this result as {{result}}]`
  );
}

/** Deterministically pick the fast-path tool (replaces Jev's `topTool` ranking).
 *  Scans the selected skills' declared tools for one in the fast-path allowlist
 *  whose required parameters all resolve from the request text, returning the
 *  first fully-resolved candidate. */
async function resolveFastPathTool(
  declared: Set<string>,
  rawMessage: string,
  databaseId: string,
): Promise<{ tool: string; values: Record<string, unknown> } | null> {
  for (const tool of FAST_PATH_TOOLS) {
    if (!declared.has(tool)) continue;
    const params = await getToolParams(tool);
    const extraction = extractParams(tool, rawMessage, params);
    const values = await fillFastPathArgs(tool, rawMessage, extraction.values, databaseId, params);
    const missing = params
      .filter((p) => p.required && values[p.name] === undefined)
      .map((p) => p.name);
    if (missing.length === 0) return { tool, values };
  }
  return null;
}
