/**
 * vers_9 orchestrator — "the LLM plans and executes, Jev verifies the result."
 *
 * This is a deliberate inversion of vers_8. vers_8 classifies intent with Jev
 * `noul`s + deterministic regex, composes a template plan, and only falls back
 * to the LLM loop for novel work. vers_9 drops the regex/noul intent-detection
 * layer entirely: the LLM builds and completes the plan through the tool-calling
 * loop (robust, open-ended), and Jev then VERIFIES the result for completeness
 * and accuracy (closed-set, no hallucination).
 *
 * Flow:
 *   deterministic gates (write-approval) → Jev routing (skill → tools) →
 *   LLM build loop (plan + execute) → Jev result verification → persist.
 *
 * Completeness/accuracy are the priority; token cost and latency are not.
 */

import { aggregator } from "../../mcp/aggregator";
import { setAllScopes } from "../../mcp/scope";
import { setAppHook, setSessionDatabaseId, setSessionId } from "../../mcp/servers/app-wfp-sessions";
import { setBuildContext } from "../../mcp/servers/app-wfp-build";
import { setRunDepth, setRunSessionId } from "@workflow/runContext";
import type { ProviderMessage, ProviderToolSchema } from "@backend/core/llm/providers";
import { getSession, updateSession, saveSession } from "@backend/core/session/sessions/session_all";
import { setParameterValue, getParameterValue, getParameterMetaValue, resolveTemplates } from "@backend/core/settings/parameterHelpers";
import { getSystemSkillNames } from "../vers_8/getSkillsPrompt";
import { route } from "../vers_8/skillRouter";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { toolNamesWhere, listCapabilities } from "../../capabilities/registry";
import { enabledSkillNamesForDatabase } from "../../core/skills/loader";
import { runLoop, mcpToolsToProvider } from "../vers_8/loop";
import type { LoopResult } from "../vers_8/loop";
import { buildSystemPrompt } from "../vers_8/prompts";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import { verifyResult } from "./verify";
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

const GUARDRAILS_SKILL = "guardrails";
const ROUTING_TOOLS = ["select_skill", "list_skills"];

// Tools always available to the loop regardless of the routed skills (mirrors
// vers_8 — plumbing + data primitives + rules + reports + planning).
const ALWAYS_AVAILABLE = [
  "show_message", "chat_download", "set_param", "get_param", "save_data",
  "list_data", "get_data", "aggregate_data", "resolve_data_shape", "judge_data",
  "compare_data", "check_data",
  "report_table", "report_qbo_pnl", "report_qbo_bs",
  "list_rules", "get_rule", "create_rule", "update_rule", "delete_rule",
  "run_workflow",
];

const WRITE_INTENT_RE =
  /\b(save|create|delete|remove|send|email|post|update|modify|edit|write|export|download|upload|publish|generate|produce|make)\b/i;

const WRITE_TOOLS = new Set([
  ...toolNamesWhere((t) => t.mutating === true),
  "chat_download",
]);

const DURABLE_TOOLS = new Set([
  ...toolNamesWhere((t) => t.durable === true),
  "chat_download",
]);

function looksMutating(raw: string): boolean {
  return WRITE_INTENT_RE.test(raw);
}

function isInformationalQuestion(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return /^(how\s+(do|to|can|should|would|does|is|are)\b|what\s+(is|are|does|do|would|should)\b|why\b|where\b|when\b|who\b|explain\b|tell\s+me\s+(how|about)\b)/.test(t);
}

function isApproval(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  return ["approve", "approved", "confirm", "confirmed", "yes", "yep", "yeah", "go ahead", "proceed", "do it", "post it"].includes(t);
}

const CONTINUATION_PHRASES = new Set([
  "continue", "go", "go on", "go ahead", "proceed", "fix", "fix it", "address that",
  "please continue", "please fix", "please proceed",
]);

function isContinuation(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (t.split(/\s+/).filter(Boolean).length > 4) return false;
  return CONTINUATION_PHRASES.has(t);
}

/** Tools disabled for this database — a capability with a group is enabled only
 *  when one of its group's skills is on. Core (ungrouped) capabilities are
 *  always available. */
function disabledToolNames(databaseId: string): Set<string> {
  const enabledSkills = enabledSkillNamesForDatabase(databaseId);
  const out = new Set<string>();
  for (const cap of listCapabilities()) {
    const m = cap.manifest;
    const enabled = !m.group || (m.skills ?? []).some((s) => enabledSkills.has(s));
    if (!enabled) for (const t of cap.tools) out.add(t.name);
  }
  return out;
}

function extractTextContent(mcpResult: any): string {
  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    return mcpResult.content.map((c: any) => c.text || "").filter(Boolean).join("\n");
  }
  if (typeof mcpResult === "string") return mcpResult;
  return JSON.stringify(mcpResult);
}

function parseToolOutput(text: string): unknown {
  if (!text) return text;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.parse(t); } catch { return text; }
  }
  return text;
}

const MAX_TOOL_RESULT_CHARS = 12000;
function truncateToolResult(full: string): string {
  if (full.length <= MAX_TOOL_RESULT_CHARS) return full;
  return full.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[output truncated — reference as {{result}}]`;
}

function extractToolCalls(messages: ProviderMessage[]): { tool: string; args: Record<string, unknown> }[] {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block.type === "tool_use") calls.push({ tool: block.name, args: block.input ?? {} });
    }
  }
  return calls;
}

function safeStringify(v: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(v ?? {});
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return String(v ?? "");
  }
}

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
    const tools = calls.map((c) => ({
      tool: c.tool,
      args: safeStringify(c.args, DURABLE_TOOLS.has(c.tool) ? 1_000_000 : 4000),
      wf_indicator: DURABLE_TOOLS.has(c.tool),
    }));
    metadata.toolCalls = [...prev, { at: new Date().toISOString(), tools }];
    await updateSession(databaseId, sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_9] persistToolCalls failed:", err.message);
  }
}

async function persistActiveSkills(databaseId: string, sessionId: string, skills: string[]): Promise<void> {
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    await updateSession(databaseId, sessionId, "metadata", { ...(fresh.metadata ?? {}), lastActiveSkills: skills });
  } catch (err: any) {
    console.error("[vers_9] persistActiveSkills failed:", err.message);
  }
}

/** A slice of deterministic-tool output, used as ground-truth evidence for the
 *  Jev result verification. */
interface EvidenceItem {
  tool: string;
  summary: string;
}

/** Tools whose output is structured, deterministic ground truth (computed
 *  figures / Jev verdicts) — collected as `evidence` so Jev can cross-check the
 *  LLM's prose against what was actually computed. */
const VERIFIABLE_TOOLS = new Set(["aggregate_data", "check_data", "judge_data", "compare_data"]);

/** Run the LLM build loop with auto-continue, writing each tool's output into
 *  session.parameters['result'] so `{{result}}` resolves identically to a
 *  workflow. Returns the loop result plus the collected verification evidence. */
async function executeLoop(opts: {
  system: string;
  messages: ProviderMessage[];
  toolSchemas: ProviderToolSchema[];
  io: OrchestratorIO;
  session: any;
}): Promise<{ result: LoopResult; evidence: EvidenceItem[] }> {
  const MAX_LOOP_PASS = 20;
  const MAX_LOOP_TOTAL = 25;
  let messages = opts.messages;
  let totalIterations = 0;
  let last: LoopResult;
  const evidence: EvidenceItem[] = [];

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
        console.log(`[vers_9] Tool: ${name}(${JSON.stringify(args).slice(0, 200)})`);
        try {
          const resolvedArgs = resolveTemplates(args, opts.session.parameters, opts.io.databaseId) as Record<string, unknown>;
          const mcpResult = await aggregator.callTool(name, resolvedArgs);
          const full = extractTextContent(mcpResult);
          if (VERIFIABLE_TOOLS.has(name)) {
            evidence.push({ tool: name, summary: full.slice(0, 2500) });
          }
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
          return truncateToolResult(full);
        } catch (err: any) {
          console.error(`[vers_9] Tool ${name} error:`, err.message);
          return `Error: ${err.message}`;
        }
      },
      maxIterations: MAX_LOOP_PASS,
    });

    totalIterations += last.iterations;
    if (!last.hitCap || totalIterations >= MAX_LOOP_TOTAL) break;

    messages = last.messages.filter(
      (m) => !(m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("I hit my step limit")),
    );
    messages.push({
      role: "user",
      content:
        "You have made many tool calls. Stop exploring — aggregate or summarize " +
        "what you already have (use aggregate_data/set_param/save_data, not more " +
        "get_data paging) and deliver the final answer or report now.",
    });
  }

  return { result: last, evidence };
}

export async function processUserMessage(
  rawMessage: string,
  session: any,
  io: OrchestratorIO,
): Promise<void> {
  setAllScopes(io.databaseId);
  setSessionDatabaseId(io.databaseId);
  setSessionId(io.sessionId);
  setRunDepth(0);
  setRunSessionId(io.sessionId);
  setBuildContext({ databaseId: io.databaseId, userId: io.userId, sessionId: io.sessionId });
  setAppHook({
    addMessage: async (msg) => { await io.addMessage(msg); },
    setParameter: (name: string, value: unknown, meta?: MetaData) => {
      session.parameters = setParameterValue(session.parameters, name, { _meta: meta ?? { type: "string" }, data: value });
      saveSession(io.databaseId, session).catch(() => {});
    },
    getParameter: (name: string) => getParameterValue(session.parameters, name, io.databaseId),
    getParameterMeta: (name: string) => getParameterMetaValue(session.parameters, name, io.databaseId),
  });

  const meta = (session?.metadata as any) ?? {};

  // ── Write-approval resume ───────────────────────────────────────────────
  if (meta.pendingWrite && isApproval(rawMessage)) {
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingWrite: undefined,
      writeApproved: true,
    });
    const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
    await processUserMessage(meta.pendingWrite.rawMessage, fresh, io);
    return;
  }

  // ── Verification-gap continuation ──────────────────────────────────────
  // After Jev flags a result, "continue"/"fix it" re-runs the request with the
  // gaps injected so the model addresses them instead of starting fresh (which
  // just re-hallucinated the same result).
  if (meta.pendingVerify && isContinuation(rawMessage)) {
    const pending = meta.pendingVerify as { rawMessage: string; reason: string };
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingVerify: undefined,
    });
    const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
    const combined =
      `${pending.rawMessage}\n\n` +
      `Jev reviewed your previous result and flagged these gaps: ${pending.reason}. ` +
      `Address each gap and re-deliver a corrected, complete result.`;
    await processUserMessage(combined, fresh, io);
    return;
  }

  // A fresh (non-continuation) request supersedes any stale verification gaps.
  if (meta.pendingVerify) {
    await updateSession(io.databaseId, io.sessionId, "metadata", { ...meta, pendingVerify: undefined });
    delete meta.pendingVerify;
  }

  await ensureEnabledSkillGroups(io.databaseId);

  // ── Jev routing (skill → tools) ─────────────────────────────────────────
  const decision = await route(io.databaseId, io.userId, rawMessage, {
    lastRequest: (session?.metadata as any)?.lastRequest,
    activeSkills: (session?.metadata as any)?.lastActiveSkills,
    sessionId: io.sessionId,
    mode: io.mode,
  });

  const allSkillNames = getSystemSkillNames(io.databaseId);
  const routedSkills = decision.selectedSkills.filter((name: string) => allSkillNames.includes(name));
  const selectedSkills: string[] = Array.from(new Set([...routedSkills, GUARDRAILS_SKILL]));
  await persistActiveSkills(io.databaseId, io.sessionId, selectedSkills);

  if (routedSkills.length === 0) {
    await io.addMessage({ markdown: "No matching rules found for this request.", json: { kind: "meta" } });
    console.log("[vers_9] Routing finished (no skills selected).\n");
    return;
  }

  await io.addMessage({
    markdown: `**Rules activated:** ${selectedSkills.map((s) => `\`${s}\``).join(", ")}${decision.skillSummary ? ` — Jev: ${decision.skillSummary}` : ""}`,
    json: { kind: "meta" },
  });

  // ── Tools follow skills (deterministic) ─────────────────────────────────
  const capability = await getCapabilityIndex();
  const declared = new Set<string>();
  for (const skill of selectedSkills) {
    const entry = capability.skills.get(skill);
    if (entry) for (const t of entry.tools) declared.add(t);
  }
  const disabledTools = disabledToolNames(io.databaseId);
  for (const t of [...declared]) if (disabledTools.has(t)) declared.delete(t);

  const workingTools = [...capability.tools.values()].filter(
    (t: any) =>
      !ROUTING_TOOLS.includes(t.name) &&
      !disabledTools.has(t.name) &&
      (declared.has(t.name) || ALWAYS_AVAILABLE.includes(t.name)),
  );

  // ── Write gate (Jev mutating + deterministic backstop) ──────────────────
  const mutatingRequest =
    !isInformationalQuestion(rawMessage) && (decision.mutating >= 0.5 || looksMutating(rawMessage));

  if (io.mode === "build" && mutatingRequest && !meta.writeApproved) {
    await io.addMessage({
      markdown: "This request will create, modify, or send data. Use the **Approve** button below to continue, or **Cancel**.",
      json: { approval: true },
    });
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingWrite: { rawMessage },
    });
    return;
  }
  if (meta.writeApproved) {
    await updateSession(io.databaseId, io.sessionId, "metadata", { ...meta, writeApproved: false });
  }

  const toolSchemas = mcpToolsToProvider(workingTools);
  const systemPrompt = buildSystemPrompt(io.mode, toolSchemas, io.databaseId, selectedSkills);

  // Recent history → provider messages.
  const sessionMessages: any[] = session.messages || [];
  const messages: ProviderMessage[] = [];
  for (const m of sessionMessages.slice(-12)) {
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role as "user" | "assistant", content: (m.markdown || "").slice(0, 2000) });
    }
  }
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" ||
      (typeof lastMsg.content === "string" && lastMsg.content.slice(0, 200).trim() !== rawMessage.slice(0, 200).trim())) {
    messages.push({ role: "user", content: rawMessage });
  }
  while (messages.length > 0 && messages[messages.length - 1].role !== "user") messages.pop();
  if (messages.length === 0) messages.push({ role: "user", content: rawMessage });

  const skillNames = selectedSkills.join(", ");
  await io.addMessage({ markdown: `> _Working with ${skillNames}..._`, json: { kind: "meta" } });

  // ── LLM build loop: plan + execute ──────────────────────────────────────
  const { result, evidence } = await executeLoop({ system: systemPrompt, messages, toolSchemas, io, session });

  const toolsUsed = result.toolCalls.map((tc) => tc.tool);
  const reply = result.reply ?? "";

  // Deliver the answer first, then badge it with Jev's verification.
  if (reply) {
    await io.addMessage({ markdown: reply, json: { kind: "reply", skills: routedSkills } });
  } else if (result.toolCalls.length > 0) {
    await io.addMessage({
      markdown: 'I stopped before producing a final answer. Say "continue" and I\'ll pick up where I left off.',
      json: { kind: "reply", skills: routedSkills },
    });
  }

  // ── Jev verifies the result (satisfies / complete / accurate) ───────────
  const verdict = await verifyResult({
    databaseId: io.databaseId,
    userId: io.userId,
    rawMessage,
    reply,
    toolsUsed,
    evidence,
  });

  if (verdict === null) {
    await io.addMessage({
      markdown: "⚠ Result verification could not run (no classifier key).",
      json: { kind: "verify", unavailable: true },
    });
  } else if (verdict.pass) {
    await io.addMessage({
      markdown:
        `✓ Verified — satisfies ${verdict.satisfies.toFixed(2)}, complete ${verdict.complete.toFixed(2)}, accurate ${verdict.accurate.toFixed(2)}`,
      json: { kind: "verify", pass: true, satisfies: verdict.satisfies, complete: verdict.complete, accurate: verdict.accurate },
    });
  } else {
    await io.addMessage({
      markdown:
        `⚠ Jev flagged this result for review (${verdict.reason}). ` +
        `Say "continue" to have the model address the gaps, or rephrase your request.`,
      json: { kind: "verify", pass: false, satisfies: verdict.satisfies, complete: verdict.complete, accurate: verdict.accurate },
    });
    // Persist the gaps so a follow-up "continue" re-runs with them injected.
    try {
      const fresh = await getSession(io.databaseId, io.sessionId);
      if (fresh) {
        await updateSession(io.databaseId, io.sessionId, "metadata", {
          ...(fresh.metadata ?? {}),
          pendingVerify: { rawMessage, reason: verdict.reason ?? "incomplete or inaccurate" },
        });
      }
    } catch (err: any) {
      console.error("[vers_9] persist pendingVerify failed:", err.message);
    }
  }

  await persistToolCalls(io.databaseId, io.sessionId, extractToolCalls(result.messages));

  console.log("[vers_9] Pipeline finished.\n");
}
