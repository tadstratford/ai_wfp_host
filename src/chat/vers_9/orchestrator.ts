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
 *   [review/analyze-shaped?] Jev-composed deterministic battery (cascade
 *     `data-review`): bulk read → profile(+footings) → check → relationships →
 *     reconcile → aggregate → DETERMINISTIC report render (no LLM narration) →
 *   else LLM build loop (plan + execute) →
 *   pre-delivery grounding check (Jev `accurate`; re-run once for the loop path) →
 *   Jev result verification → persist.
 *
 * Completeness/accuracy are the priority; token cost and latency are not — with
 * three mitigations: audit-shaped requests are planned by Jev (not free-explored),
 * their report is assembled deterministically from tool evidence (no names or
 * figures can be confabulated), and the loop path's low-`accurate` reply is
 * re-grounded before it reaches the user.
 */

import { aggregator } from "../../mcp/aggregator";
import { setAllScopes } from "../../mcp/scope";
import { setAppHook, setSessionDatabaseId, setSessionId } from "../../mcp/servers/app-wfp-sessions";
import { setBuildContext } from "../../mcp/servers/app-wfp-build";
import { setDiaryContext } from "../../mcp/servers/app-diary";
import { setRunDepth, setRunSessionId } from "@workflow/runContext";
import type { ProviderMessage, ProviderToolSchema } from "@backend/core/llm/providers";
import { getSession, updateSession, saveSession } from "@backend/core/session/sessions/session_all";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
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
import { cascadePlanner } from "../plan/cascade";
import type { NodePlan } from "../plan";
import { llmCall } from "@backend/core/llm/llmCall";
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
  "reconcile_relationship", "list_relationships",
  "profile_data", "classify_data", "split_data",
  "report_table", "report_qbo_pnl", "report_qbo_bs",
  "list_skills", "get_skill", "create_skill", "update_skill", "delete_skill",
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

export function isApproval(raw: string): boolean {
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
export interface EvidenceItem {
  tool: string;
  summary: string;
}

/** Tools whose output is structured, deterministic ground truth (computed
 *  figures / Jev verdicts) — collected as `evidence` so Jev can cross-check the
 *  LLM's prose against what was actually computed. */
const VERIFIABLE_TOOLS = new Set(["aggregate_data", "check_data", "judge_data", "compare_data", "reconcile_relationship", "profile_data", "classify_data", "split_data"]);

/** How many same-signature aggregate_data calls before we warn about fan-out. */
const FANOUT_THRESHOLD = 5;

/** Signature identifying "the same aggregate question, re-run per entity": two
 *  aggregate_data calls share a signature when their group_by and filter columns
 *  match — only the filter *value* changes, i.e. per-entity fan-out. */
function fanoutSignature(args: Record<string, unknown>): string {
  const gb = JSON.stringify(args.group_by ?? null);
  const f = args.filter;
  const cols = Array.isArray(f)
    ? f.map((x: any) => (x && typeof x === "object" ? String(x.column ?? "") : "")).join("|")
    : "";
  return `${gb}::${cols}`;
}

// ── Prior-turn evidence persistence (follow-up grounding) ───────────────────
// Tool results are NOT part of the persisted chat history, so on a follow-up
// turn the model only sees its own prose — not the numbers behind it (which is
// why it can "forget" what it computed and fabricate). We persist a compact,
// already-privacy-masked slice of the deterministic-tool evidence and re-inject
// it on the next turn so follow-ups stay grounded.

const MAX_EVIDENCE_ITEMS = 10;
const MAX_EVIDENCE_ITEM_CHARS = 1500;

function compactEvidence(evidence: EvidenceItem[]): EvidenceItem[] {
  return evidence.slice(-MAX_EVIDENCE_ITEMS).map((e) => ({
    tool: e.tool,
    summary: e.summary.length > MAX_EVIDENCE_ITEM_CHARS ? e.summary.slice(0, MAX_EVIDENCE_ITEM_CHARS) : e.summary,
  }));
}

async function persistEvidence(databaseId: string, sessionId: string, evidence: EvidenceItem[]): Promise<void> {
  if (evidence.length === 0) return; // keep the prior turn's evidence until newer evidence replaces it
  try {
    const fresh = await getSession(databaseId, sessionId);
    if (!fresh) return;
    await updateSession(databaseId, sessionId, "metadata", {
      ...(fresh.metadata ?? {}),
      lastEvidence: compactEvidence(evidence),
    });
  } catch (err: any) {
    console.error("[vers_9] persistEvidence failed:", err.message);
  }
}

function buildPriorEvidenceSection(evidence: EvidenceItem[]): string {
  const lines = evidence.map((e) => `[${e.tool}] ${e.summary}`);
  return (
    `\n\n## Prior analysis evidence (your previous turn)\n` +
    `These are the deterministic tool results you computed in the previous turn. ` +
    `Ground any follow-up answer in these figures — do not re-derive or invent numbers. ` +
    `If the user's question is not answerable from this evidence, run the tools again rather than guessing.\n` +
    lines.join("\n")
  );
}

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
  let fanoutSig = "";
  let fanoutCount = 0;

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
          // Detect per-entity fan-out: the same aggregate question re-run with
          // only the filter value changing (e.g. "Write off - Creare", "… - Lake
          // Shore", …). Warn instead of letting the loop burn every iteration.
          let fanoutWarning = "";
          if (name === "aggregate_data") {
            const sig = fanoutSignature(resolvedArgs);
            if (sig && sig === fanoutSig) fanoutCount++;
            else { fanoutSig = sig; fanoutCount = 1; }
            if (fanoutCount >= FANOUT_THRESHOLD) {
              fanoutCount = 0;
              fanoutWarning =
                "\n\n⚠ STOP — you are repeating aggregate_data once per entity (fan-out). " +
                "Instead make ONE aggregate_data call with group_by on the entity column, " +
                "or a single compare_data between the two aggregated tables, then deliver the final answer.";
            }
          }
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
          const out = truncateToolResult(full);
          return fanoutWarning ? out + fanoutWarning : out;
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

/** A turn's deliverable: the prose reply plus the tool evidence + tool names
 *  that grounded it (fed to Jev's result verification). */
export interface TurnOutcome {
  reply: string;
  toolsUsed: string[];
  evidence: EvidenceItem[];
  /** Structured visual payload; when present the turn delivers a `review` card
   *  instead of a plain markdown reply. */
  review?: ReviewPayload;
  /** Scope + facts markdown shown collapsed alongside the review card. */
  receipts?: string;
  /** Non-empty when the valuation comparison is ambiguous and the user must
   *  choose a pair before the report is complete. */
  pendingClarify?: CandidatePair[];
}

/** Jev-compose a read-only review request (data-account-check) into a
 *  deterministic battery. Returns null when the planner can't compose it, so the
 *  caller falls back to the build loop. */
export async function tryComposeReviewPlan(
  io: OrchestratorIO,
  rawMessage: string,
  selectedSkills: string[],
): Promise<NodePlan | null> {
  try {
    const result = await cascadePlanner.plan({
      databaseId: io.databaseId,
      userId: io.userId,
      rawMessage,
      tools: [],
      activeSkills: selectedSkills,
      complexity: 0,
      mutating: 0,
    });
    if (result.kind === "plan" && result.plan.steps.length > 0) return result.plan;
    return null;
  } catch (err: any) {
    console.warn(`[vers_9] review plan failed (falling back to loop): ${err.message}`);
    return null;
  }
}

/** Extract canonical entity/account names from the deterministic evidence (the
 *  group keys of `aggregate_data`, the mismatch keys of `reconcile_relationship`)
 *  so the render can be handed an exact name list to copy. This is the strongest
 *  defense against the model confabulating plausible corporate names (e.g. a
 *  "Meridian …" family) that do not exist in the data. */
function extractKnownNames(evidence: EvidenceItem[]): string[] {
  const names = new Set<string>();
  const addString = (v: unknown) => {
    if (typeof v === "string" && v.trim() && /\w{3,}/.test(v)) names.add(v);
  };
  const addObjValues = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    for (const v of Object.values(obj as Record<string, unknown>)) addString(v);
  };
  for (const e of evidence) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.summary);
    } catch {
      continue;
    }
    const p = parsed as any;
    if (e.tool === "aggregate_data") {
      for (const g of p?.groups ?? []) addObjValues(g?.key);
    } else if (e.tool === "reconcile_relationship") {
      for (const m of p?.mismatches ?? []) addString(m?.key);
      for (const k of [...(p?.missing_left ?? []), ...(p?.missing_right ?? [])]) addString(k);
    }
  }
  return [...names];
}

/** Deterministically assemble a compact "verified facts" block from the tool
 *  evidence — entity/account names and figures templated verbatim from the JSON
 *  (never free-typed by an LLM), so the ground truth always reaches the user
 *  even if the prose above it confabulates. */
function buildFactsBlock(evidence: EvidenceItem[]): string {
  const lines: string[] = [];
  const profiled = new Set<string>();
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") {
      const name = p?.name;
      if (!name || profiled.has(name)) continue;
      profiled.add(name);
      const nullCols = (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ");
      lines.push(
        `- \`${name}\`: ${p?.rowCount} rows, duplicate rows ${p?.duplicateRows ?? 0}` +
          (nullCols ? `, nulls: ${nullCols}` : ""),
      );
    } else if (e.tool === "aggregate_data") {
      const name = p?.name;
      for (const g of p?.groups ?? []) {
        const key = g?.key
          ? Object.entries(g.key as Record<string, unknown>)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "(total)";
        const meas = Object.entries(g?.measures ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        lines.push(`- \`${name}\` [${key}]: ${meas}`);
      }
    } else if (e.tool === "reconcile_relationship") {
      const s = p?.summary ?? {};
      lines.push(
        `- reconcile: matched ${s.matched}, mismatched ${s.mismatched}, ` +
          `missing_left ${s.missing_left}, missing_right ${s.missing_right}`,
      );
      for (const m of (p?.mismatches ?? []).slice(0, 20)) {
        lines.push(`  - ${m.key}: left ${m.left} vs right ${m.right} (diff ${m.difference})`);
      }
      for (const k of (p?.missing_right ?? []).slice(0, 10)) {
        lines.push(`  - missing on right: ${k}`);
      }
    } else if (e.tool === "check_data") {
      for (const c of Array.isArray(p) ? p : []) {
        lines.push(`- check \`${c?.id}\`: ${c?.noul}`);
      }
    }
  }
  return lines.join("\n");
}

/** Map a deterministic severity (0..1) to a red/yellow/green verdict label. */
function verdictLabel(score: number): string {
  if (score >= 0.6) return "🔴 Red";
  if (score >= 0.3) return "🟡 Yellow";
  return "🟢 Green";
}

/** Deterministic data-review report — assembled directly from the tool evidence,
 *  no LLM narration. Entity/account names and figures are templated verbatim
 *  from the JSON (there is no path for hallucination), and each of the eight
 *  review categories gets a red/yellow/green verdict from fixed thresholds over
 *  the deterministic tool scores. */
export function renderReviewReport(
  evidence: EvidenceItem[],
  relationshipsOutput: any,
  rawMessage: string,
): string {
  const profiles: any[] = [];
  const aggregates: any[] = [];
  const reconciles: any[] = [];
  const checks: { id: string; noul: number }[] = [];
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") profiles.push(p);
    else if (e.tool === "aggregate_data") aggregates.push(p);
    else if (e.tool === "reconcile_relationship") reconciles.push(p);
    else if (e.tool === "check_data" && Array.isArray(p)) {
      for (const c of p) {
        if (c && typeof c?.noul === "number") checks.push({ id: c.id, noul: c.noul });
      }
    }
  }

  const check = (id: string): number => checks.find((x) => x.id === id)?.noul ?? 0;

  if (profiles.length === 0 && aggregates.length === 0 && reconciles.length === 0 && checks.length === 0) {
    return "The review battery returned no evidence — no tables were profiled, aggregated, or reconciled.";
  }

  // ── Scope ────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const scopeRows: string[] = [];
  for (const p of profiles) {
    const name = p?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const nullText =
      (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ") || "—";
    scopeRows.push(
      `| \`${name}\` | ${p?.rowCount ?? "?"} | ${p?.columnCount ?? "?"} | ${p?.duplicateRows ?? 0} | ${nullText} |`,
    );
  }

  // ── Verdicts ─────────────────────────────────────────────────────────────
  const verdicts: { category: string; severity: number; basis: string }[] = [];

  // 1. Completeness
  {
    const nulls = new Map<string, number>();
    for (const p of profiles) {
      for (const c of p?.columns ?? []) {
        if ((c?.nullCount ?? 0) > 0) nulls.set(c.column, (nulls.get(c.column) ?? 0) + c.nullCount);
      }
    }
    const keyRe = /\b(id|name|account|date|amount|entity|gl|txn|currency|status|code|class|description|memo)\b/i;
    const keyNull = [...nulls.keys()].filter((c) => keyRe.test(c));
    let severity = check("missing_key_fields");
    if (keyNull.length > 0) severity = Math.max(severity, 0.9);
    else if (nulls.size > 0) severity = Math.max(severity, 0.4);
    const basis = nulls.size
      ? `null columns: ${[...nulls.entries()].map(([c, n]) => `${c}(${n})`).join(", ")}` +
        (keyNull.length ? " — key fields affected" : "")
      : "no null columns";
    verdicts.push({ category: "Completeness", severity, basis: `${basis}; missing_key_fields ${check("missing_key_fields").toFixed(2)}` });
  }

  // 2. Existence / orphans
  {
    const dup = profiles.reduce((s, p) => s + (p?.duplicateRows ?? 0), 0);
    // Only aggregate diffs signal true orphans (a key present in one source but
    // absent from the other). A "contains" reconcile's "missing" is just partial
    // coverage (e.g. active deals never appear in the write-off ledger), not an
    // orphan, and valuation mismatches belong to the Valuation verdict below.
    const missing = reconciles
      .filter((r) => r?.kind !== "contains")
      .reduce((s, r) => s + (r?.summary?.missing_left ?? 0) + (r?.summary?.missing_right ?? 0), 0);
    let severity = 0;
    if (missing > 0) severity = 0.9;
    else if (dup > 0) severity = 0.5;
    else severity = Math.max(check("renamed_entities"), check("duplicates"));
    verdicts.push({
      category: "Existence / orphans",
      severity,
      basis: `duplicate rows ${dup}; orphans ${missing}; renamed_entities ${check("renamed_entities").toFixed(2)}`,
    });
  }

  // 3. Footing / cross-foot
  {
    const footings: any[] = [];
    for (const p of profiles) for (const f of p?.footings ?? []) footings.push(f);
    let severity: number;
    let basis: string;
    if (footings.length === 0) {
      severity = 0.4;
      basis = "no explicit footings verified (aggregate totals only)";
    } else {
      const failed = footings.filter((f) => f?.holds === false);
      severity = failed.length > 0 ? 0.9 : 0;
      basis = footings
        .map((f) => `${f?.label ?? f?.leftColumn}: ${f?.holds ? "holds" : "DOES NOT hold"}`)
        .join("; ");
    }
    verdicts.push({ category: "Footing / cross-foot", severity, basis });
  }

  // 4. Valuation / agreement
  {
    const realMismatches: any[] = [];
    let matched = 0;
    let mismatched = 0;
    for (const r of reconciles) {
      matched += r?.summary?.matched ?? 0;
      mismatched += r?.summary?.mismatched ?? 0;
      for (const m of r?.mismatches ?? []) {
        if (Math.abs(Number(m?.difference ?? 0)) > 1e-6) realMismatches.push(m);
      }
    }
    let severity: number;
    let basis: string;
    if (reconciles.length === 0) {
      severity = 0.4;
      basis = "no relationships reconciled";
    } else {
      severity = realMismatches.length > 0 ? 0.9 : 0;
      basis = `matched ${matched}, mismatched ${mismatched}` +
        (realMismatches.length
          ? ` — e.g. ${realMismatches.slice(0, 3).map((m) => `${m.key} diff ${m.difference}`).join("; ")}`
          : "");
    }
    verdicts.push({ category: "Valuation / agreement", severity, basis });
  }

  // 5. Classification / allocation
  {
    const severity = Math.max(check("miscoded"), check("unallocated"));
    verdicts.push({
      category: "Classification / allocation",
      severity,
      basis: `miscoded ${check("miscoded").toFixed(2)}, unallocated ${check("unallocated").toFixed(2)}`,
    });
  }

  // 6. Cutoff / timing
  {
    const severity = check("date_issues");
    verdicts.push({ category: "Cutoff / timing", severity, basis: `date_issues ${check("date_issues").toFixed(2)}` });
  }

  // 7. Consistency
  {
    let severity = Math.max(check("inconsistent_naming"), check("renamed_entities"));
    const suspense = aggregates
      .flatMap((a) => a?.groups ?? [])
      .filter((g) => /to be allocated|suspense|clearing/i.test(g?.key ? JSON.stringify(g.key) : ""));
    const nonZero = suspense.filter((g) => {
      const v = Object.values(g?.measures ?? {})[0];
      return Math.abs(Number(v ?? 0)) > 1e-6;
    });
    if (nonZero.length > 0) severity = Math.max(severity, 0.9);
    verdicts.push({
      category: "Consistency",
      severity,
      basis: `inconsistent_naming ${check("inconsistent_naming").toFixed(2)}, renamed_entities ${check("renamed_entities").toFixed(2)}; suspense/clearing non-zero groups: ${nonZero.length}`,
    });
  }

  // 8. No guessing
  {
    const hasNulls = profiles.some((p) => (p?.columns ?? []).some((c: any) => (c?.nullCount ?? 0) > 0));
    const severity = Math.max(check("amount_sign"), hasNulls ? 0.4 : 0);
    verdicts.push({
      category: "No guessing",
      severity,
      basis: `amount_sign ${check("amount_sign").toFixed(2)}; unresolved nulls ${hasNulls ? "present" : "none"}`,
    });
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  const title = /review|audit/i.test(rawMessage) ? "Data review" : "Data analysis";
  const lines: string[] = [`# ${title}`];
  if (scopeRows.length) {
    lines.push("", "## Scope", "| Table | Rows | Columns | Duplicate rows | Null columns |", "|---|---|---|---|---|", ...scopeRows);
  }
  lines.push("", "## Verdicts", "| Category | Verdict | Basis |", "|---|---|---|");
  for (const v of verdicts) lines.push(`| ${v.category} | ${verdictLabel(v.severity)} | ${v.basis} |`);

  const facts = buildFactsBlock(evidence);
  if (facts) lines.push("", "## Verified facts (read directly from tool output)", facts);

  return lines.join("\n");
}

/** Format a money amount as a signed dollar figure (whole dollars). */
function fmtMoney(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  return `${rounded < 0 ? "-" : ""}$${abs.toLocaleString("en-US")}`;
}

/** Assign a table a display role for the relationship map. */
function roleOf(name: string): string {
  const n = name.toLowerCase();
  if (/transaction|ledger|journal|subledger/.test(n)) return "ledger";
  if (/exception|flag|action|worklist|unallocated/.test(n)) return "worklist";
  if (/elimination|summary|trial|balance|check/.test(n)) return "summary";
  if (/position|statement|report/.test(n)) return "report";
  if (/rule|basis|headcount|revenue|footage|rate|mapping|allocation/.test(n)) return "reference";
  return "other";
}

/** A review category's red/yellow/green verdict plus a plain-language summary. */
export interface ReviewVerdict {
  category: string;
  severity: number;
  summary: string;
  basis: string;
  ref: string;
}

export interface ReviewNode {
  id: string;
  ref: string;
  label: string;
  role: string;
  rows: number;
  columns: number;
  dupRows: number;
  nullCols: number;
  nullColNames: string[];
}

export interface ReviewEdge {
  from: string;
  to: string;
  ref: string;
  keyCol: string;
  kind: string;
  status: "tie" | "variance" | "partial" | "unknown";
  label: string;
  detail: string;
}

export interface ReviewVariance {
  key: string;
  left: number;
  right: number;
  diff: number;
  ref: string;
}

export interface ReviewPayload {
  title: string;
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  variances: ReviewVariance[];
  verdicts: ReviewVerdict[];
  narration?: string;
  notes?: string[];
}

interface EvidenceCtx {
  profiles: any[];
  aggregates: any[];
  reconciles: any[];
  checks: { id: string; noul: number }[];
  check: (id: string) => number;
}

function parseEvidence(evidence: EvidenceItem[]): EvidenceCtx {
  const profiles: any[] = [];
  const aggregates: any[] = [];
  const reconciles: any[] = [];
  const checks: { id: string; noul: number }[] = [];
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") profiles.push(p);
    else if (e.tool === "aggregate_data") aggregates.push(p);
    else if (e.tool === "reconcile_relationship") reconciles.push(p);
    else if (e.tool === "check_data" && Array.isArray(p)) {
      for (const c of p) {
        if (c && typeof c?.noul === "number") checks.push({ id: c.id, noul: c.noul });
      }
    }
  }
  const check = (id: string): number => checks.find((x) => x.id === id)?.noul ?? 0;
  return { profiles, aggregates, reconciles, checks, check };
}

/** Compute the eight review verdicts (severity + technical basis + one-line
 *  plain-language summary) from the deterministic evidence. */
function computeVerdicts(ctx: EvidenceCtx): Omit<ReviewVerdict, "ref">[] {
  const { profiles, aggregates, reconciles, check } = ctx;
  const verdicts: Omit<ReviewVerdict, "ref">[] = [];

  {
    const nulls = new Map<string, number>();
    for (const p of profiles) {
      for (const c of p?.columns ?? []) {
        if ((c?.nullCount ?? 0) > 0) nulls.set(c.column, (nulls.get(c.column) ?? 0) + c.nullCount);
      }
    }
    const keyRe = /\b(id|name|account|date|amount|entity|gl|txn|currency|status|code|class|description|memo)\b/i;
    const keyNull = [...nulls.keys()].filter((c) => keyRe.test(c));
    let severity = check("missing_key_fields");
    if (keyNull.length > 0) severity = Math.max(severity, 0.9);
    else if (nulls.size > 0) severity = Math.max(severity, 0.4);
    const basis = nulls.size
      ? `null columns: ${[...nulls.entries()].map(([c, n]) => `${c}(${n})`).join(", ")}` +
        (keyNull.length ? " — key fields affected" : "")
      : "no null columns";
    const summary = keyNull.length > 0
      ? `${keyNull.length} key field${keyNull.length === 1 ? "" : "s"} blank`
      : nulls.size > 0
        ? `${nulls.size} column${nulls.size === 1 ? "" : "s"} have blanks`
        : "no missing fields";
    verdicts.push({ category: "Completeness", severity, summary, basis: `${basis}; missing_key_fields ${check("missing_key_fields").toFixed(2)}` });
  }

  {
    const dup = profiles.reduce((s, p) => s + (p?.duplicateRows ?? 0), 0);
    const missing = reconciles
      .filter((r) => r?.kind !== "contains")
      .reduce((s, r) => s + (r?.summary?.missing_left ?? 0) + (r?.summary?.missing_right ?? 0), 0);
    let severity = 0;
    if (missing > 0) severity = 0.9;
    else if (dup > 0) severity = 0.5;
    else severity = Math.max(check("renamed_entities"), check("duplicates"));
    const summary = missing > 0
      ? `${missing} orphan key${missing === 1 ? "" : "s"}`
      : dup > 0
        ? `${dup} duplicate row${dup === 1 ? "" : "s"}`
        : check("renamed_entities") >= 0.6
          ? "possible renamed entities"
          : "no orphans";
    verdicts.push({
      category: "Existence / orphans",
      severity,
      summary,
      basis: `duplicate rows ${dup}; orphans ${missing}; renamed_entities ${check("renamed_entities").toFixed(2)}`,
    });
  }

  {
    const footings: any[] = [];
    for (const p of profiles) for (const f of p?.footings ?? []) footings.push(f);
    let severity: number;
    let basis: string;
    let summary: string;
    if (footings.length === 0) {
      severity = 0.4;
      basis = "no explicit footings verified (aggregate totals only)";
      summary = "totals not auto-verified";
    } else {
      const failed = footings.filter((f) => f?.holds === false);
      severity = failed.length > 0 ? 0.9 : 0;
      basis = footings
        .map((f) => `${f?.label ?? f?.leftColumn}: ${f?.holds ? "holds" : "DOES NOT hold"}`)
        .join("; ");
      summary = failed.length > 0 ? `${failed.length} footing${failed.length === 1 ? "" : "s"} fail` : "footings hold";
    }
    verdicts.push({ category: "Footing / cross-foot", severity, summary, basis });
  }

  {
    const realMismatches: any[] = [];
    let matched = 0;
    let mismatched = 0;
    for (const r of reconciles) {
      matched += r?.summary?.matched ?? 0;
      mismatched += r?.summary?.mismatched ?? 0;
      for (const m of r?.mismatches ?? []) {
        if (Math.abs(Number(m?.difference ?? 0)) > 1e-6) realMismatches.push(m);
      }
    }
    let severity: number;
    let basis: string;
    let summary: string;
    if (reconciles.length === 0) {
      severity = 0.4;
      basis = "no relationships reconciled";
      summary = "not yet reconciled";
    } else {
      severity = realMismatches.length > 0 ? 0.9 : 0;
      basis = `matched ${matched}, mismatched ${mismatched}` +
        (realMismatches.length
          ? ` — e.g. ${realMismatches.slice(0, 3).map((m) => `${m.key} diff ${m.difference}`).join("; ")}`
          : "");
      const net = realMismatches.reduce((s, m) => s + Number(m?.difference ?? 0), 0);
      summary = realMismatches.length > 0
        ? `${realMismatches.length} value${realMismatches.length === 1 ? "" : "s"} don't tie (net ${fmtMoney(net)})`
        : "all values tie";
    }
    verdicts.push({ category: "Valuation / agreement", severity, summary, basis });
  }

  {
    const severity = Math.max(check("miscoded"), check("unallocated"));
    const summary = check("unallocated") >= 0.6
      ? "large unallocated share"
      : check("miscoded") >= 0.6
        ? "coding issues"
        : "classification clean";
    verdicts.push({
      category: "Classification / allocation",
      severity,
      summary,
      basis: `miscoded ${check("miscoded").toFixed(2)}, unallocated ${check("unallocated").toFixed(2)}`,
    });
  }

  {
    const severity = check("date_issues");
    const summary = severity >= 0.6 ? "date/timing problems" : "timing clean";
    verdicts.push({ category: "Cutoff / timing", severity, summary, basis: `date_issues ${check("date_issues").toFixed(2)}` });
  }

  {
    let severity = Math.max(check("inconsistent_naming"), check("renamed_entities"));
    const suspense = aggregates
      .flatMap((a) => a?.groups ?? [])
      .filter((g) => /to be allocated|suspense|clearing/i.test(g?.key ? JSON.stringify(g.key) : ""));
    const nonZero = suspense.filter((g) => {
      const v = Object.values(g?.measures ?? {})[0];
      return Math.abs(Number(v ?? 0)) > 1e-6;
    });
    if (nonZero.length > 0) severity = Math.max(severity, 0.9);
    const summary = severity >= 0.6 ? "naming inconsistencies" : "naming consistent";
    verdicts.push({
      category: "Consistency",
      severity,
      summary,
      basis: `inconsistent_naming ${check("inconsistent_naming").toFixed(2)}, renamed_entities ${check("renamed_entities").toFixed(2)}; suspense/clearing non-zero groups: ${nonZero.length}`,
    });
  }

  {
    const hasNulls = profiles.some((p) => (p?.columns ?? []).some((c: any) => (c?.nullCount ?? 0) > 0));
    const severity = Math.max(check("amount_sign"), hasNulls ? 0.4 : 0);
    const summary = check("amount_sign") >= 0.6
      ? "unexpected signs"
      : hasNulls
        ? "some blanks remain"
        : "no signs of guessing";
    verdicts.push({
      category: "No guessing",
      severity,
      summary,
      basis: `amount_sign ${check("amount_sign").toFixed(2)}; unresolved nulls ${hasNulls ? "present" : "none"}`,
    });
  }

  return verdicts;
}

/** Assemble the structured visual payload (relationship map + variance strip +
 *  verdict cards) plus the two markdown strings the turn needs: `verify` (full
 *  text for Jev) and `receipts` (scope + facts only, shown collapsed). Returns
 *  null when the battery produced no evidence. */
export function buildReview(
  evidence: EvidenceItem[],
  relationshipsOutput: any,
  rawMessage: string,
): { payload: ReviewPayload; verify: string; receipts: string } | null {
  const ctx = parseEvidence(evidence);
  const { profiles, aggregates, reconciles } = ctx;
  if (profiles.length === 0 && aggregates.length === 0 && reconciles.length === 0 && ctx.checks.length === 0) {
    return null;
  }

  const title = /review|audit/i.test(rawMessage) ? "Data review" : "Data analysis";
  const nodes: ReviewNode[] = profiles.map((p, i) => ({
    id: p?.name,
    ref: `node-${i}`,
    label: shortTableName(p?.name ?? ""),
    role: roleOf(p?.name ?? ""),
    rows: p?.rowCount ?? 0,
    columns: p?.columnCount ?? 0,
    dupRows: p?.duplicateRows ?? 0,
    nullCols: (p?.columns ?? []).filter((c: any) => (c?.nullCount ?? 0) > 0).length,
    nullColNames: (p?.columns ?? [])
      .filter((c: any) => (c?.nullCount ?? 0) > 0)
      .map((c: any) => `${c.column} (${c.nullCount})`),
  }));

  const edges: ReviewEdge[] = [];
  const variances: ReviewVariance[] = [];
  const seen = new Set<string>();
  for (const r of reconciles) {
    const lt = r?.left;
    const rt = r?.right;
    if (!lt || !rt) continue;
    const key = `${lt}|${rt}|${r?.on_left ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r?.kind === "aggregate") {
      const mm = r?.mismatches ?? [];
      const ms = r?.matches ?? [];
      const totalDiff = mm.reduce((s: number, m: any) => s + Number(m?.difference ?? 0), 0);
      const diffParts = mm.map((m: any) => `${m.key} ${fmtMoney(Number(m?.difference ?? 0))}`);
      const tieParts = ms.map((m: any) => `${m.key} tie`);
      edges.push({
        from: lt,
        to: rt,
        ref: `edge-${edges.length}`,
        keyCol: r?.on_left ?? "",
        kind: "aggregate",
        status: mm.length > 0 ? "variance" : "tie",
        label: mm.length > 0
          ? `${r?.on_left ?? ""} · ${mm.length} differ (${fmtMoney(totalDiff)})`
          : `${r?.on_left ?? ""} · ties`,
        detail: [diffParts.join("; "), tieParts.join("; ")].filter(Boolean).join("; "),
      });
      for (const m of ms) variances.push({ key: m.key, left: m.left, right: m.right, diff: 0, ref: "" });
      for (const m of mm) variances.push({ key: m.key, left: m.left, right: m.right, diff: Number(m?.difference ?? 0), ref: "" });
    } else {
      const s = r?.summary ?? {};
      const total = (s.matched ?? 0) + (s.missing_left ?? 0) + (s.missing_right ?? 0);
      const status: ReviewEdge["status"] = (s.mismatched ?? 0) > 0
        ? "variance"
        : (s.missing_left ?? 0) + (s.missing_right ?? 0) > 0
          ? "partial"
          : "tie";
      edges.push({
        from: lt,
        to: rt,
        ref: `edge-${edges.length}`,
        keyCol: r?.on_left ?? "",
        kind: r?.kind ?? "",
        status,
        label: `${r?.on_left ?? ""} · ${s.matched ?? 0}/${total} matched`,
        detail: `matched ${s.matched ?? 0}, mismatched ${s.mismatched ?? 0}, missing ${(s.missing_left ?? 0) + (s.missing_right ?? 0)}`,
      });
    }
  }

  // (Faint "shares <column>" links were removed — they added noise without
  // insight. The map now shows only reconciled edges.)

  // Mismatches first (largest diff), then ties — so the variance strip leads
  // with the problems.
  variances.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const variancesRef: ReviewVariance[] = variances.map((v, i) => ({ ...v, ref: `var-${i}` }));

  const verdicts = computeVerdicts(ctx).map((v, i) => ({ ...v, ref: `verdict-${i}` }));

  const seenScope = new Set<string>();
  const scopeRows: string[] = [];
  for (const p of profiles) {
    const name = p?.name;
    if (!name || seenScope.has(name)) continue;
    seenScope.add(name);
    const nullText =
      (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ") || "—";
    scopeRows.push(`| \`${name}\` | ${p?.rowCount ?? "?"} | ${p?.columnCount ?? "?"} | ${p?.duplicateRows ?? 0} | ${nullText} |`);
  }
  const receiptsLines: string[] = [];
  if (scopeRows.length) {
    receiptsLines.push("## Scope", "| Table | Rows | Columns | Duplicate rows | Null columns |", "|---|---|---|---|---|", ...scopeRows);
  }
  const facts = buildFactsBlock(evidence);
  if (facts) receiptsLines.push("", "## Verified facts (read directly from tool output)", facts);
  const receipts = receiptsLines.join("\n");

  const verify = renderReviewReport(evidence, relationshipsOutput, rawMessage);

  return { payload: { title, nodes, edges, variances: variancesRef, verdicts }, verify, receipts };
}

/** Final LLM critic pass over the deterministic report (display-only): flags
 *  semantic errors the deterministic battery cannot catch (e.g. comparing
 *  different units) and explains in plain English what was done and what it
 *  means. The model is forbidden from introducing new numbers/names, so the
 *  deterministic report remains authoritative and its output never rewrites a
 *  figure. Returns null when the critic produces nothing usable (or fails). */
async function runReviewCritic(
  databaseId: string,
  reply: string,
  evidence: EvidenceItem[],
): Promise<{ issues: string[]; meaning: string; unavailable?: boolean } | null> {
  const facts = buildFactsBlock(evidence).slice(0, 6000);
  const systemPrompt =
    "You are reviewing an auto-generated data-review report produced by deterministic " +
    "tools (no LLM wrote it). Do NOT introduce any new numbers, entity/account names, or " +
    "facts — only reference what is shown in the report or the facts digest. " +
    "Respond with JSON only: {\"issues\": [\"...\"], \"meaning\": \"...\"}. " +
    "\"issues\" lists any errors or inconsistencies you can see (comparing different units, " +
    "a verdict the evidence does not support, a reconciliation that looks wrong); use an empty " +
    "array if you find none. \"meaning\" is a short plain-English explanation of what was done " +
    "and what the findings imply, in 2-4 sentences.";
  try {
    const result = await llmCall(databaseId, "chat:review-critic", {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: `REPORT:\n${reply}\n\nFACTS (verbatim tool output):\n${facts || "(none)"}`,
        },
      ],
      maxTokens: 800,
      temperature: 0,
      responseFormat: "json",
    });
    const data = (result.data ?? {}) as Record<string, unknown>;
    const issues = Array.isArray(data.issues)
      ? (data.issues as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const meaning = typeof data.meaning === "string" ? data.meaning : "";
    if (issues.length === 0 && !meaning) return null;
    return { issues, meaning };
  } catch (err: any) {
    console.warn(`[vers_9] review critic failed (unavailable): ${err.message}`);
    return { issues: [], meaning: "", unavailable: true };
  }
}

/** Columns whose name suggests a numeric "amount" to foot/reconcile. */
const AMOUNT_HINT = /amount|total|balance|debit|credit|fee|revenue|cost|principal|interest|value|price|gross|net|sum/i;

/** Columns that are ratios/proportions, not absolute amounts (e.g. "% of
 *  Total"). These must never be reconciled against a currency amount — comparing
 *  a percentage to dollars produces a meaningless "difference". */
const RATIO_HINT = /%|percent|pct|share|ratio|proportion|rate\b/i;

/** True when a column name/type represents a ratio or percentage rather than an
 *  absolute amount. */
function isRatioColumn(column: string, types: Record<string, string> | null): boolean {
  if (RATIO_HINT.test(column)) return true;
  const t = types?.[column];
  if (typeof t === "string") return /percent|percentage|ratio/i.test(t);
  return false;
}

/** Resolve a table's numeric amount column (inferred type first, name second)
 *  so a discovered relationship can be reconciled without guessing a column.
 *  Ratio/percentage columns are excluded: they are not absolute amounts. */
function pickAmountColumn(databaseId: string, tableName: string): string | null {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return null;
    const e = ws.getDataEntry(tableName);
    if (!e) return null;
    const columns: string[] = Array.isArray(e?.columns) ? (e.columns as string[]) : [];
    const types = (e?.column_types as Record<string, string> | null) ?? null;
    const numeric = columns.filter((c) => {
      if (isRatioColumn(c, types)) return false;
      const t = types?.[c];
      if (typeof t === "string") return /number|integer|float|decimal|currency|percent/i.test(t);
      return AMOUNT_HINT.test(c);
    });
    // Only a genuine amount-named column qualifies; a table with just counts or
    // percentages (e.g. a headcount basis table) yields null and is skipped.
    return numeric.find((c) => AMOUNT_HINT.test(c)) ?? null;
  } catch {
    return null;
  }
}

/** Resolve a column's inferred type string (empty string when unknown). */
function columnType(databaseId: string, tableName: string, column: string): string {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return "";
    const e = ws.getDataEntry(tableName);
    if (!e) return "";
    const types = (e?.column_types as Record<string, string> | null) ?? null;
    return (typeof types?.[column] === "string" ? types[column] : "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when two amount columns can be meaningfully compared. A percentage/ratio
 *  is never comparable to a currency, so such a pairing is rejected. */
function amountsComparable(
  databaseId: string,
  leftTable: string,
  leftCol: string,
  rightTable: string,
  rightCol: string,
): boolean {
  const lt = columnType(databaseId, leftTable, leftCol);
  const rt = columnType(databaseId, rightTable, rightCol);
  const isPercent = (t: string, name: string) => /percent|percentage|ratio/.test(t) || RATIO_HINT.test(name);
  const lp = isPercent(lt, leftCol);
  const rp = isPercent(rt, rightCol);
  if (lp || rp) return lp === rp;
  const currency = (t: string) => /currency|decimal|number|float|integer/i.test(t);
  return currency(lt) && currency(rt);
}

/** Rank a discovered relationship by how meaningful a reconcile it yields: a
 *  "contains" link (key embedded in a text column, e.g. a deal name inside a
 *  description) or an entity/name-keyed link beats a trivial ID-to-ID equality
 *  join, which would otherwise surface "missing" rows that are missing by design. */
function rankRelationship(rel: any): number {
  let score = 0;
  if (rel?.kind === "contains") score += 4;
  const idHint = /\b(id|code|num|txn|ref|seq|no)\b/i;
  const keyCols = [rel?.left?.column ?? "", rel?.right?.column ?? ""];
  if (keyCols.some((c) => !idHint.test(c))) score += 2;
  if (keyCols.every((c) => !idHint.test(c))) score += 1;
  score += Number(rel?.confidence ?? 0);
  score += Math.min(1, Number(rel?.coverage ?? 0));
  return score;
}

/** A candidate cross-source valuation pair: two tables aggregated on the same
 *  group-key column, each with a currency measure. Offered to the user as a menu
 *  when the data does not make the ledger-vs-report pairing explicit. */
export interface CandidatePair {
  index: number;
  leftTable: string;
  rightTable: string;
  keyCol: string;
  leftMeasure: string;
  rightMeasure: string;
  leftShort: string;
  rightShort: string;
}
/** Shorten a table name for a menu (strip synthetic/long prefixes). */
function shortTableName(name: string): string {
  return name
    .replace(/^synth_/i, "")
    .replace(/^interco_audit_demo_/i, "")
    .replace(/^ic_report_/i, "")
    .replace(/_/g, " ");
}

/** True when an aggregate measure key (e.g. "sum_Amount (USD)") represents a
 *  currency-ish amount rather than a count or a percentage. */
function isCurrencyMeasure(measureKey: string): boolean {
  const col = measureKey.replace(/^sum_/i, "");
  if (RATIO_HINT.test(col)) return false;
  if (/\b(usd|eur|gbp|jpy|chf|cad|aud|nzd|\$)\b/i.test(col)) return true;
  return AMOUNT_HINT.test(col) && !/count|headcount|qty|quantity|units|employees/i.test(col);
}

/** Discover candidate valuation pairs from the aggregate evidence: tables that
 *  were aggregated on the SAME group-key column with a currency measure. */
function buildCandidatePairs(aggregates: any[]): CandidatePair[] {
  const byKey = new Map<string, { table: string; measure: string; short: string }[]>();
  for (const a of aggregates) {
    const groups = a?.groups ?? [];
    if (!groups.length) continue;
    const keyObj = groups[0]?.key ?? {};
    const keyCols = Object.keys(keyObj);
    if (keyCols.length === 0) continue;
    const keyCol = keyCols[0];
    const measureKeys = Object.keys(groups[0]?.measures ?? {});
    const measure = measureKeys.find((m) => isCurrencyMeasure(m)) ?? null;
    const name = a?.name;
    if (!measure || !name) continue;
    if (!byKey.has(keyCol)) byKey.set(keyCol, []);
    byKey.get(keyCol)!.push({ table: name, measure, short: shortTableName(name) });
  }
  const pairs: CandidatePair[] = [];
  for (const [keyCol, entries] of byKey) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        pairs.push({
          index: pairs.length,
          leftTable: entries[i].table,
          rightTable: entries[j].table,
          keyCol,
          leftMeasure: entries[i].measure,
          rightMeasure: entries[j].measure,
          leftShort: entries[i].short,
          rightShort: entries[j].short,
        });
      }
    }
  }
  return pairs;
}

/** Diff two aggregates on a shared key, producing a result shaped like
 *  `reconcile_relationship` so the deterministic renderer consumes it unchanged. */
function diffAggregates(leftAgg: any, rightAgg: any, pair: CandidatePair): any {
  const lv = new Map<string, number>();
  const rv = new Map<string, number>();
  for (const g of leftAgg?.groups ?? []) {
    const v = g?.key?.[pair.keyCol];
    const m = g?.measures?.[pair.leftMeasure];
    if (v === undefined || v === null || m === undefined || m === null) continue;
    lv.set(String(v), Number(m));
  }
  for (const g of rightAgg?.groups ?? []) {
    const v = g?.key?.[pair.keyCol];
    const m = g?.measures?.[pair.rightMeasure];
    if (v === undefined || v === null || m === undefined || m === null) continue;
    rv.set(String(v), Number(m));
  }
  const mismatches: any[] = [];
  const matches: any[] = [];
  const missing_left: string[] = [];
  const missing_right: string[] = [];
  let matched = 0;
  for (const [k, l] of lv) {
    if (!rv.has(k)) {
      missing_right.push(k);
      continue;
    }
    const r = rv.get(k)!;
    const difference = Math.round(((l ?? 0) - (r ?? 0)) * 100) / 100;
    if (Math.abs(difference) > 1e-6) mismatches.push({ key: k, left: l, right: r, difference });
    else {
      matched++;
      matches.push({ key: k, left: l, right: r });
    }
  }
  for (const k of rv.keys()) if (!lv.has(k)) missing_left.push(k);
  return {
    left: pair.leftTable,
    right: pair.rightTable,
    on_left: pair.keyCol,
    on_right: pair.keyCol,
    kind: "aggregate",
    tolerance: 0,
    summary: {
      matched,
      mismatched: mismatches.length,
      missing_left: missing_left.length,
      missing_right: missing_right.length,
    },
    mismatches,
    matches,
    missing_right,
    missing_left,
  };
}

/** Resolve a user's menu selection into a candidate pair. Accepts an ordinal
 *  ("first"/"second"), any in-range number ("1", "please do 1", "option 2"),
 *  or the two table names. Returns null when nothing selects a pair. */
function resolveClarifyChoice(message: string, candidates: CandidatePair[]): CandidatePair | null {
  const m = message.trim();
  const lower = m.toLowerCase();

  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const ordinalIdx = ordinals.findIndex((o) => new RegExp(`\\b${o}\\b`).test(lower));
  if (ordinalIdx >= 0 && ordinalIdx < candidates.length) return candidates[ordinalIdx];

  for (const mm of m.matchAll(/(\d+)/g)) {
    const idx = parseInt(mm[1], 10) - 1;
    if (idx >= 0 && idx < candidates.length) return candidates[idx];
  }

  const matched = candidates.filter((c) => {
    const l = [c.leftShort, c.leftTable].map((x) => x.toLowerCase()).filter(Boolean);
    const r = [c.rightShort, c.rightTable].map((x) => x.toLowerCase()).filter(Boolean);
    return l.some((x) => lower.includes(x)) && r.some((y) => lower.includes(y));
  });
  return matched.length === 1 ? matched[0] : null;
}

/** The post-battery reconciliation phase, factored out so vers_11 can reuse the
 *  same dynamic reconcile + aggregate-diff the deterministic report depends on.
 *  Consumes the collected evidence + `list_relationships` output, adds
 *  `reconcile_relationship` / aggregate-diff evidence, and returns the augmented
 *  evidence plus any ambiguous valuation pair that still needs the user to pick. */
export async function reconcileReviewEvidence(opts: {
  databaseId: string;
  session: any;
  evidence: EvidenceItem[];
  relationshipsOutput: any;
}): Promise<{ evidence: EvidenceItem[]; toolsUsed: string[]; pendingClarify: CandidatePair[] }> {
  const evidence = opts.evidence.slice();
  const toolsUsed: string[] = [];
  const relationshipsOutput = opts.relationshipsOutput;
  const session = opts.session;

  const rels = (Array.isArray(relationshipsOutput?.relationships) ? relationshipsOutput.relationships : [])
    .filter((r: any) => r?.kind === "contains")
    .slice()
    .sort((a: any, b: any) => rankRelationship(b) - rankRelationship(a))
    .slice(0, 2);

  for (const rel of rels) {
    const relId = rel?.id;
    const leftTable = rel?.left?.table;
    const rightTable = rel?.right?.table;
    if (!relId || !leftTable || !rightTable) continue;
    const compareLeft = pickAmountColumn(opts.databaseId, leftTable);
    const compareRight = pickAmountColumn(opts.databaseId, rightTable);
    if (!compareLeft || !compareRight) continue;
    if (!amountsComparable(opts.databaseId, leftTable, compareLeft, rightTable, compareRight)) continue;
    try {
      const args = { relationship_id: relId, compare_left: compareLeft, compare_right: compareRight };
      const mcpResult = await aggregator.callTool("reconcile_relationship", args);
      const full = extractTextContent(mcpResult);
      evidence.push({ tool: "reconcile_relationship", summary: full.slice(0, 2500) });
      toolsUsed.push("reconcile_relationship");
      session.parameters = setParameterValue(session.parameters, "result", {
        _meta: { type: "text" },
        data: parseToolOutput(full),
      });
    } catch (err: any) {
      console.error(`[vers_9] reconcileReviewEvidence reconcile error:`, err.message);
    }
  }

  const aggregates = evidence
    .filter((e) => e.tool === "aggregate_data")
    .map((e) => {
      try { return JSON.parse(e.summary); } catch { return null; }
    })
    .filter(Boolean) as any[];

  const forcedChoice = (session?.metadata as any)?.clarifyChoice as CandidatePair | null | undefined;
  let pendingClarify: CandidatePair[] = [];

  if (forcedChoice) {
    const leftAgg = aggregates.find((a) => a?.name === forcedChoice.leftTable);
    const rightAgg = aggregates.find((a) => a?.name === forcedChoice.rightTable);
    if (leftAgg && rightAgg) {
      evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, forcedChoice)) });
      toolsUsed.push("reconcile_relationship");
    }
  } else {
    const pairs = buildCandidatePairs(aggregates);
    const preferred = pairs.filter((p) => {
      const lr = roleOf(p.leftTable);
      const rr = roleOf(p.rightTable);
      return (lr === "ledger" && rr === "report") || (lr === "report" && rr === "ledger");
    });
    const candidates = preferred.length > 0 ? preferred : pairs;
    if (candidates.length === 1) {
      const p = candidates[0];
      const leftAgg = aggregates.find((a) => a?.name === p.leftTable);
      const rightAgg = aggregates.find((a) => a?.name === p.rightTable);
      if (leftAgg && rightAgg) {
        evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, p)) });
        toolsUsed.push("reconcile_relationship");
      }
    } else if (candidates.length > 1) {
      pendingClarify = candidates.map((c, i) => ({ ...c, index: i }));
    }
  }

  return { evidence, toolsUsed, pendingClarify };
}

/** Execute a Jev-composed plan inline: each step's output is written to `result`
 *  and collected as verification evidence (no raw rows are streamed to the
 *  user). Discovered relationships are then reconciled, and the report is
 *  assembled deterministically from the evidence (no LLM narration). */
export async function runComposedPlan(opts: {
  plan: NodePlan;
  io: OrchestratorIO;
  session: any;
  rawMessage: string;
}): Promise<TurnOutcome> {
  const evidence: EvidenceItem[] = [];
  const toolsUsed: string[] = [];
  let stepNo = 0;
  let relationshipsOutput: any = null;

  for (const step of opts.plan.steps) {
    stepNo++;
    await opts.io.addMessage({
      markdown: `Step ${stepNo} \u00b7 \`${step.tool_id}\``,
      json: { kind: "step", tool: step.tool_id, iteration: stepNo },
    });
    try {
      const resolvedArgs = resolveTemplates(step.tool_parameters, opts.session.parameters, opts.io.databaseId) as Record<string, unknown>;
      const mcpResult = await aggregator.callTool(step.tool_id, resolvedArgs);
      const full = extractTextContent(mcpResult);
      if (VERIFIABLE_TOOLS.has(step.tool_id)) {
        evidence.push({ tool: step.tool_id, summary: full.slice(0, 2500) });
      }
      toolsUsed.push(step.tool_id);
      const resultValue = parseToolOutput(full);
      if (step.tool_id === "list_relationships") relationshipsOutput = resultValue;
      opts.session.parameters = setParameterValue(opts.session.parameters, "result", {
        _meta: { type: "text" },
        data: resultValue,
      });
    } catch (err: any) {
      console.error(`[vers_9] plan step ${step.tool_id} error:`, err.message);
    }
  }

  // ── Dynamic reconciliation ───────────────────────────────────────────────
  // Only "contains" links (a key embedded in a text column, e.g. a deal name
  // inside a ledger description) are meaningful to reconcile directly. "equals"
  // links the catalog finds are usually a small lookup table (headcount/rates)
  // matching an entity column — reconciling those produces spurious "mismatch"
  // noise, so they are skipped here; entity-vs-report valuation is handled by
  // aggregate diffing below instead.
  const rels = (Array.isArray(relationshipsOutput?.relationships) ? relationshipsOutput.relationships : [])
    .filter((r: any) => r?.kind === "contains")
    .slice()
    .sort((a: any, b: any) => rankRelationship(b) - rankRelationship(a))
    .slice(0, 2);
  for (const rel of rels) {
    const relId = rel?.id;
    const leftTable = rel?.left?.table;
    const rightTable = rel?.right?.table;
    if (!relId || !leftTable || !rightTable) continue;
    const compareLeft = pickAmountColumn(opts.io.databaseId, leftTable);
    const compareRight = pickAmountColumn(opts.io.databaseId, rightTable);
    if (!compareLeft || !compareRight) continue;
    if (!amountsComparable(opts.io.databaseId, leftTable, compareLeft, rightTable, compareRight)) continue;
    stepNo++;
    await opts.io.addMessage({
      markdown: `Step ${stepNo} \u00b7 \`reconcile_relationship\``,
      json: { kind: "step", tool: "reconcile_relationship", iteration: stepNo },
    });
    try {
      const args = { relationship_id: relId, compare_left: compareLeft, compare_right: compareRight };
      const mcpResult = await aggregator.callTool("reconcile_relationship", args);
      const full = extractTextContent(mcpResult);
      evidence.push({ tool: "reconcile_relationship", summary: full.slice(0, 2500) });
      toolsUsed.push("reconcile_relationship");
      opts.session.parameters = setParameterValue(opts.session.parameters, "result", {
        _meta: { type: "text" },
        data: parseToolOutput(full),
      });
    } catch (err: any) {
      console.error(`[vers_9] dynamic reconcile error:`, err.message);
    }
  }

  // ── Aggregate diffing (cross-source valuation) ───────────────────────────
  // When the catalog has no "contains" link (the many-to-one entity case), the
  // valuation check comes from comparing two currency aggregates that share a
  // group key. Exactly one pairing → diff it now; several → ask the user to pick
  // the ledger-vs-report pair (menu). The diff is shaped like reconcile_relationship
  // output so the deterministic renderer consumes it unchanged.
  const aggregates = evidence
    .filter((e) => e.tool === "aggregate_data")
    .map((e) => {
      try {
        return JSON.parse(e.summary);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as any[];

  const forcedChoice = (opts.session?.metadata as any)?.clarifyChoice as CandidatePair | null | undefined;

  let pendingClarify: CandidatePair[] | null = null;

  if (forcedChoice) {
    const leftAgg = aggregates.find((a) => a?.name === forcedChoice.leftTable);
    const rightAgg = aggregates.find((a) => a?.name === forcedChoice.rightTable);
    if (leftAgg && rightAgg) {
      evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, forcedChoice)) });
      toolsUsed.push("reconcile_relationship");
    }
  } else {
    const pairs = buildCandidatePairs(aggregates);
    // Prefer the ledger↔report pairing when it is unambiguous; only ask when
    // several plausible ledger/report candidates remain (e.g. multiple staging
    // ledgers). This makes the common case fully automatic — no menu.
    const preferred = pairs.filter((p) => {
      const lr = roleOf(p.leftTable);
      const rr = roleOf(p.rightTable);
      return (lr === "ledger" && rr === "report") || (lr === "report" && rr === "ledger");
    });
    const candidates = preferred.length > 0 ? preferred : pairs;
    if (candidates.length === 1) {
      const p = candidates[0];
      const leftAgg = aggregates.find((a) => a?.name === p.leftTable);
      const rightAgg = aggregates.find((a) => a?.name === p.rightTable);
      if (leftAgg && rightAgg) {
        evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, p)) });
        toolsUsed.push("reconcile_relationship");
      }
    } else if (candidates.length > 1) {
      // Re-index so the menu numbers are a clean 1..N (candidates may be a
      // filtered subset whose original indexes are non-contiguous).
      pendingClarify = candidates.map((c, i) => ({ ...c, index: i }));
    }
  }

  const built = buildReview(evidence, relationshipsOutput, opts.rawMessage);
  const reply = built?.verify ?? renderReviewReport(evidence, relationshipsOutput, opts.rawMessage);
  const receipts = built?.receipts ?? "";

  if (pendingClarify) {
    const menu = pendingClarify
      .map(
        (p) =>
          `${p.index + 1}. \`${p.leftShort}\` (${p.leftMeasure.replace(/^sum_/i, "")}) ↔ \`${p.rightShort}\` (${p.rightMeasure.replace(/^sum_/i, "")})`,
      )
      .join("\n");
    const ask =
      `\n\n## Which tables should I reconcile?\n` +
      `I found several tables keyed on \`${pendingClarify[0].keyCol}\` with currency amounts, ` +
      `but the data does not make the ledger-vs-report pairing explicit. ` +
      `Reply with the number of the pair you want reconciled:\n\n${menu}\n`;
    return { reply: reply + ask, toolsUsed, evidence, pendingClarify };
  }

  // Display-only LLM critic: explains what was done/what it means and flags any
  // semantic error, but never rewrites the deterministic report's figures.
  const critic = await runReviewCritic(opts.io.databaseId, reply, evidence);
  let finalReply = reply;
  let narration: string | undefined;
  let notes: string[] | undefined;
  if (critic?.unavailable) {
    await opts.io.addMessage({
      markdown: "ℹ Review explanation unavailable (no general-model key configured); the deterministic report below stands on its own.",
      json: { kind: "meta" },
    });
  } else if (critic) {
    notes = critic.issues.length > 0 ? critic.issues : undefined;
    narration = critic.meaning || undefined;
    const parts: string[] = [reply];
    if (critic.issues.length > 0) {
      parts.push("", "## Review notes", critic.issues.map((s) => `- ⚠ ${s}`).join("\n"));
    }
    if (critic.meaning) {
      parts.push("", "## What this means", critic.meaning);
    }
    finalReply = parts.join("\n");
  }

  const review: ReviewPayload | undefined = built ? { ...built.payload, narration, notes } : undefined;
  return { reply: finalReply, toolsUsed, evidence, review, receipts };
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
  setDiaryContext({ databaseId: io.databaseId });
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
    const pending = meta.pendingVerify as {
      rawMessage: string;
      reason: string;
      satisfies?: number;
      complete?: number;
      accurate?: number;
      thorough?: number;
    };
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingVerify: undefined,
    });
    const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
    let nudge =
      `Jev reviewed your previous result and flagged these gaps: ${pending.reason}. ` +
      `Address each gap and re-deliver a corrected, complete result.`;
    if (typeof pending.accurate === "number" && pending.accurate < 0.6) {
      nudge +=
        ` Your previous answer's figures were NOT grounded in the tool results ` +
        `(accuracy ${pending.accurate.toFixed(2)}). Re-run the tools and report ONLY ` +
        `numbers you read directly from the tool results — never reconstruct a figure from memory.`;
    }
    const combined = `${pending.rawMessage}\n\n${nudge}`;
    await processUserMessage(combined, fresh, io);
    return;
  }

  // ── Clarification resume (valuation menu) ────────────────────────────────
  // When the cross-source comparison was ambiguous, the previous turn asked the
  // user to pick a ledger-vs-report pair. Resolve their answer and re-run the
  // deterministic battery with that pair forced.
  if (meta.pendingClarify) {
    const pending = meta.pendingClarify as { rawMessage: string; candidates: CandidatePair[] };
    const choice = resolveClarifyChoice(rawMessage, pending.candidates);
    if (choice) {
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...meta,
        pendingClarify: undefined,
        clarifyChoice: choice,
      });
      const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
      await processUserMessage(pending.rawMessage, fresh, io);
      return;
    }
    // Unrecognized answer — keep the menu and nudge, instead of dropping into the
    // LLM loop (which would re-hallucinate the review).
    await io.addMessage({
      markdown: 'Please reply with the number of the pair (e.g. "1"), or paste one of the table pairs listed above.',
      json: { kind: "meta" },
    });
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
  let systemPrompt = buildSystemPrompt(io.mode, toolSchemas, io.databaseId, selectedSkills);
  // Re-inject the previous turn's computed evidence so follow-ups stay grounded
  // (tool results are not otherwise part of the persisted history).
  const priorEvidence = meta.lastEvidence as EvidenceItem[] | undefined;
  if (Array.isArray(priorEvidence) && priorEvidence.length > 0) {
    systemPrompt += buildPriorEvidenceSection(priorEvidence);
  }

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

  // ── Plan-first lane (audit-shaped) → deterministic battery, else build loop ─
  // A read-only review/audit/reconcile request (data-account-check) is composed
  // by Jev into a deterministic battery and executed inline, instead of the LLM
  // free-exploring table-by-table. Anything the planner can't compose (or any
  // non-review request) falls through to the build loop.
  const reviewShaped =
    io.mode === "build" &&
    !mutatingRequest &&
    routedSkills.some((s) => s === "data-account-check");

  const GROUNDING_NUDGE =
    "Your previous answer's figures or names were NOT grounded in the tool results " +
    "(accuracy below threshold). Re-run the tools and report ONLY numbers and " +
    "entity/account names you read directly from the tool results — copy every " +
    "name VERBATIM from the data and never reconstruct a figure from memory. " +
    "If a figure is not in a tool result, say so explicitly instead of writing it.";

  const runLoopTurn = async (
    msgs: ProviderMessage[],
  ): Promise<{ reply: string; toolsUsed: string[]; evidence: EvidenceItem[]; messages: ProviderMessage[] }> => {
    const { result: loopResult, evidence: loopEvidence } = await executeLoop({
      system: systemPrompt,
      messages: msgs,
      toolSchemas,
      io,
      session,
    });
    return {
      reply: loopResult.reply ?? "",
      toolsUsed: loopResult.toolCalls.map((tc) => tc.tool),
      evidence: loopEvidence,
      messages: loopResult.messages,
    };
  };

  let reply: string;
  let evidence: EvidenceItem[];
  let toolsUsed: string[];
  let finalMessages: ProviderMessage[];
  let composedPlan: NodePlan | null = null;
  let reviewVisual: ReviewPayload | undefined;
  let receipts: string = "";

  if (reviewShaped) {
    composedPlan = await tryComposeReviewPlan(io, rawMessage, selectedSkills);
  }

  if (composedPlan) {
    const out = await runComposedPlan({ plan: composedPlan, io, session, rawMessage });
    reply = out.reply;
    evidence = out.evidence;
    toolsUsed = out.toolsUsed;
    finalMessages = [];
    reviewVisual = out.review;
    receipts = out.receipts ?? "";

    // A one-shot clarification choice is consumed by the composed run above.
    if ((session?.metadata as any)?.clarifyChoice) {
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...meta,
        clarifyChoice: undefined,
      });
    }

    if (out.pendingClarify && out.pendingClarify.length > 0) {
      // The valuation comparison is ambiguous: deliver the report + menu and wait
      // for the user to pick a pair. Skip Jev verification — the turn is not done.
      if (reply) {
        await io.addMessage({ markdown: reply, json: { kind: "reply", skills: routedSkills } });
      }
      await persistToolCalls(
        io.databaseId,
        io.sessionId,
        composedPlan.steps.map((s) => ({ tool: s.tool_id, args: s.tool_parameters })),
      );
      await updateSession(io.databaseId, io.sessionId, "metadata", {
        ...meta,
        pendingClarify: { rawMessage, candidates: out.pendingClarify },
      });
      console.log("[vers_9] awaiting clarification (valuation menu).\n");
      return;
    }
  } else {
    const first = await runLoopTurn(messages);
    reply = first.reply;
    evidence = first.evidence;
    toolsUsed = first.toolsUsed;
    finalMessages = first.messages;
  }

  // Persist this turn's computed evidence for follow-up grounding.
  await persistEvidence(io.databaseId, io.sessionId, evidence);

  // ── Pre-delivery grounding check ─────────────────────────────────────────
  // Verify BEFORE delivering. The plan path's report is assembled
  // deterministically (names/figures templated from evidence), so only the
  // free-form loop path can hallucinate and needs a grounding re-run.
  const ACCURATE_GATE = 0.6;
  let verdict = await verifyResult({
    databaseId: io.databaseId,
    userId: io.userId,
    rawMessage,
    reply,
    toolsUsed,
    evidence,
  });

  if (
    verdict !== null &&
    !verdict.pass &&
    verdict.accurate < ACCURATE_GATE &&
    reply &&
    !composedPlan
  ) {
    const knownNames = extractKnownNames(evidence);
    const namesBlock = knownNames.length
      ? `\n\nHere are the ONLY entity/account/identifier names that exist in the data (copy them exactly, never invent, rename, or add):\n` +
        knownNames.map((n) => `- ${n}`).join("\n")
      : "";
    const retryMessages = finalMessages
      .filter(
        (m) =>
          !(m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("I hit my step limit")),
      )
      .concat([{ role: "user", content: GROUNDING_NUDGE + namesBlock } as ProviderMessage]);
    const second = await runLoopTurn(retryMessages);
    reply = second.reply;
    evidence = [...evidence, ...second.evidence];
    toolsUsed = [...toolsUsed, ...second.toolsUsed];
    finalMessages = second.messages;
    await persistEvidence(io.databaseId, io.sessionId, evidence);
    verdict = await verifyResult({
      databaseId: io.databaseId,
      userId: io.userId,
      rawMessage,
      reply,
      toolsUsed,
      evidence,
    });
  }

  // ── Deliver, then badge with Jev's verification ──────────────────────────
  if (reply) {
    if (reviewVisual) {
      await io.addMessage({
        markdown: receipts,
        json: { kind: "review", review: reviewVisual, skills: routedSkills },
      });
    } else {
      await io.addMessage({ markdown: reply, json: { kind: "reply", skills: routedSkills } });
    }
  } else if (toolsUsed.length > 0) {
    await io.addMessage({
      markdown: 'I stopped before producing a final answer. Say "continue" and I\'ll pick up where I left off.',
      json: { kind: "reply", skills: routedSkills },
    });
  }

  if (verdict === null) {
    await io.addMessage({
      markdown: "⚠ Result verification could not run (no classifier key).",
      json: { kind: "verify", unavailable: true },
    });
  } else if (verdict.pass) {
    await io.addMessage({
      markdown:
        `✓ Verified — satisfies ${verdict.satisfies.toFixed(2)}, complete ${verdict.complete.toFixed(2)}, accurate ${verdict.accurate.toFixed(2)}, thorough ${verdict.thorough.toFixed(2)}`,
      json: { kind: "verify", pass: true, satisfies: verdict.satisfies, complete: verdict.complete, accurate: verdict.accurate, thorough: verdict.thorough },
    });
  } else {
    await io.addMessage({
      markdown:
        `⚠ Jev flagged this result for review (${verdict.reason}). ` +
        `Say "continue" to have the model address the gaps, or rephrase your request.`,
      json: { kind: "verify", pass: false, satisfies: verdict.satisfies, complete: verdict.complete, accurate: verdict.accurate, thorough: verdict.thorough },
    });
    // Persist the gaps so a follow-up "continue" re-runs with them injected.
    try {
      const fresh = await getSession(io.databaseId, io.sessionId);
      if (fresh) {
        await updateSession(io.databaseId, io.sessionId, "metadata", {
          ...(fresh.metadata ?? {}),
          pendingVerify: {
            rawMessage,
            reason: verdict.reason ?? "incomplete or inaccurate",
            satisfies: verdict.satisfies,
            complete: verdict.complete,
            accurate: verdict.accurate,
            thorough: verdict.thorough,
          },
        });
      }
    } catch (err: any) {
      console.error("[vers_9] persist pendingVerify failed:", err.message);
    }
  }

  if (composedPlan) {
    await persistToolCalls(
      io.databaseId,
      io.sessionId,
      composedPlan.steps.map((s) => ({ tool: s.tool_id, args: s.tool_parameters })),
    );
  } else {
    await persistToolCalls(io.databaseId, io.sessionId, extractToolCalls(finalMessages));
  }

  console.log("[vers_9] Pipeline finished.\n");
}
