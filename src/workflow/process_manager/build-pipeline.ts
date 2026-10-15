/**
 * Build Pipeline — Multi-Stage Workflow Builder
 *
 *   Stage 1: PLAN — one LLM call → structured BuildPlan JSON
 *   Stage 2: WIRE WORKFLOW — deterministic, no LLM
 *   Stage 3: INTEGRATION TEST — run full workflow
 *
 * Workflows are composed from the existing tool catalog (native + MCP tools)
 * only — no code is generated.
 */

import { callLLM as rawCallLLM } from "@backend/core/llm/llm-client";
import { logUsage } from "@backend/core/llm/usageTracker";
import type { LLMCaller } from "./build-pipeline-types";
import { loadPrompt, loadConcepts } from "@chat/prompts/loader";
import { isMcpToolAllowed } from "@mcp/policy";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { listWidgetDefinitions } from "@frontend/templates/index";
// Side-effect imports: register the widget templates so listWidgetDefinitions()
// is populated whenever the build pipeline runs (not just after the UI router loads).
import "@frontend/templates/account-table";
import "@frontend/templates/entity-manager";
import "@frontend/templates/data-table";
import { buildManifest, formatManifest } from "@chat/context/manifest";
import { loadRules } from "@rules/loader";
import { createWorkflow } from "../createWorkflow";
// buildAddNode appends a tool node to a workflow via the active WorkspaceSession.
import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/** Build a catalog of the MCP tools a workflow step may call via `api.mcp`
 *  (read/analysis + constructive planning writes), formatted for the planner.
 *  Each entry includes the tool's full JSON input schema (so the planner emits
 *  exact parameter names/types, not hallucinated ones like `aggregations`) and
 *  its result contract (so it can wire `{{result}}` and persist correctly). */
async function buildMcpToolsSection(): Promise<string> {
  try {
    const { tools } = await getCapabilityIndex();
    const lines = [...tools.values()]
      .filter((t) => isMcpToolAllowed(t.name))
      .map((t) => {
        const desc = t.description.trim();
        let block = `### \`${t.name}\` (server "${t.server}")\n${desc}`;
        if (t.inputSchema && Object.keys(t.inputSchema as object).length > 0) {
          block += `\nInput schema:\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 2)}\n\`\`\``;
        }
        block += `\nOutput: \`${t.output.metaType}\`${t.output.tabular ? " (tabular)" : ""}`;
        return block;
      });
    return lines.length > 0 ? lines.join("\n\n") : "No MCP tools available.";
  } catch (err: any) {
    return `MCP tools unavailable: ${err?.message ?? err}`;
  }
}

async function cleanupOldLogs(dir: string, maxFiles: number): Promise<void> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith(".md") || f.endsWith(".json") || f.endsWith(".js"))
      .map((f: string) => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.time - a.time);
    if (files.length > maxFiles) {
      for (const f of files.slice(maxFiles)) {
        try { fs.unlinkSync(path.join(dir, f.name)); } catch {}
      }
    }
  } catch {}
}

async function buildAddNode(databaseId: string, workflowId: string, node: { label: string; tool_id: string; toolParameters?: any; chatMsgBody?: string }) {
  const ws = requireSessionByDatabaseId(databaseId);
  const wf = ws.getWorkflow(workflowId);
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);
  const nodes = [...wf.nodes];
  const nodeId = `node-${Math.random().toString(36).slice(2, 8)}`;
  nodes.push({
    id: nodeId,
    type: "tool",
    label: node.label,
    tool_id: node.tool_id,
    tool_parameters: node.toolParameters || {},
    step_order: nodes.length + 1,
  } as any);
  ws.upsertWorkflow({ ...wf, nodes, updated_at: new Date().toISOString() });
  return { node_id: nodeId };
}

/** Ensure the workflow ends with a `workflow_audit` node. Appends one (before
 *  the `workflow_end` marker, if present) when the built workflow lacks it, so
 *  every workflow ends in a fail-closed audit that trigger adapters can read. */
async function ensureTerminalAudit(databaseId: string, workflowId: string, log: string[]): Promise<void> {
  const ws = requireSessionByDatabaseId(databaseId);
  const wf = ws.getWorkflow(workflowId);
  if (!wf) return;
  const nodes = [...(wf.nodes ?? [])];
  if (nodes.some((n) => (n as any).tool_id === "workflow_audit")) return;

  const endIdx = nodes.findIndex((n) => (n as any).tool_id === "workflow_end");
  const insertAt = endIdx >= 0 ? endIdx : nodes.length;
  const auditNode = {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: "tool",
    label: "Audit Workflow",
    tool_id: "workflow_audit",
    tool_parameters: {},
  } as any;

  const withAudit = [
    ...nodes.slice(0, insertAt),
    auditNode,
    ...nodes.slice(insertAt),
  ].map((n, i) => ({ ...n, step_order: i + 1 }));

  ws.upsertWorkflow({ ...wf, nodes: withAudit, updated_at: new Date().toISOString() });
  log.push("  Ensured terminal workflow_audit node");
}
import { testWorkflow, canAutoTest } from "./build-test";
import { getToolDefinition } from "@core/tools/registry";
import { appendChangelog } from "@backend/core/workflow/changelog";
import type { BuildPlan, BuildPipelineParams, BuildPipelineResult } from "./build-pipeline-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a short summary from a workflow description markdown. */
function extractSummary(description: string): string {
  // Try to find the Purpose section and grab its first sentence
  const purposeMatch = description.match(/##\s*Purpose\s*\n+([\s\S]*?)(?:\n##|\n\n\n|$)/i);
  if (purposeMatch) {
    const firstSentence = purposeMatch[1].trim().split(/\.\s/)[0];
    if (firstSentence) return firstSentence.length > 200 ? firstSentence.substring(0, 197) + "..." : firstSentence + ".";
  }
  // Fallback: first non-heading, non-empty line
  for (const line of description.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("*Created")) {
      return trimmed.length > 200 ? trimmed.substring(0, 197) + "..." : trimmed;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Build progress — in-memory status (logged to console + included in response)
// ---------------------------------------------------------------------------

const buildProgress = new Map<string, string>();
const buildCancelled = new Set<string>();

export function getBuildProgress(databaseId: string): string {
  return buildProgress.get(databaseId) || "";
}

/** Signal the build pipeline to abort at the next stage checkpoint. */
export function cancelBuild(databaseId: string): void {
  buildCancelled.add(databaseId);
  console.log(`[build] Cancel requested for ${databaseId}`);
}

/** Check if build has been cancelled. Throws if yes (caught by pipeline). */
function checkCancelled(databaseId: string): void {
  if (buildCancelled.has(databaseId)) {
    buildCancelled.delete(databaseId);
    throw new BuildCancelledError();
  }
}

export class BuildCancelledError extends Error {
  constructor() { super("Build cancelled by user"); this.name = "BuildCancelledError"; }
}

function setProgress(databaseId: string, message: string): void {
  buildProgress.set(databaseId, message);
  console.log(`[build] ${message}`);
}

function clearProgress(databaseId: string): void {
  buildProgress.delete(databaseId);
  buildCancelled.delete(databaseId);
}

/** Format the workspace's rules for the planner. App skills are
 *  excluded — they are agent meta-instructions, not domain rules. */
function buildUserRulesSection(databaseId: string): string {
  try {
    const rules = loadRules(databaseId);
    if (rules.length === 0) return "No workspace rules.";
    return rules.map((s) => `### ${s.name}\n${s.content}`).join("\n\n");
  } catch {
    return "No workspace rules.";
  }
}

/** Serialize every registered widget definition (id + description + JSON schema)
 *  so the planner knows the exact `data` shape a `chat_download`
 *  widget step must emit. */
function widgetSchemasSection(): string {
  const defs = listWidgetDefinitions();
  if (defs.length === 0) return "No widget templates are registered.";
  return defs
    .map((d) => {
      const schemaJson = JSON.stringify(d.schema, null, 2);
      return `### Widget: \`${d.widget_id}\`\n${d.description_md}\n\nSchema:\n\`\`\`json\n${schemaJson}\n\`\`\``;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Stage 1: PLAN — produce a structured BuildPlan from user request
// ---------------------------------------------------------------------------

async function stagePlan(
  userMessage: string,
  databaseId: string,
  userId: string,
  callLLM: LLMCaller,
  chatHistory?: Array<{ role: string; content: string }>,
  plannerPrompt: string = "pipeline/planner",
): Promise<{ plan: BuildPlan; displayText: string; unresolvedInputs: string[] }> {
  // Build manifest with data file schemas
  const manifest = await buildManifest(databaseId, userId);
  const manifestText = formatManifest(manifest);

  // Extract data files section for the planner prompt
  const dataFilesSection = manifest.dataFiles.length > 0
    ? manifest.dataFiles.map(f => {
        let detail = f.name;
        if (f.sourceFilename) detail += ` (${f.sourceFilename})`;
        const parts: string[] = [];
        if ((f as any).contentType && (f as any).contentType !== 'text') parts.push((f as any).contentType.toUpperCase());
        if ((f as any).rowCount != null) parts.push(`${(f as any).rowCount} rows`);
        if ((f as any).columns) {
          try { parts.push(`columns: ${JSON.parse((f as any).columns).join(', ')}`); } catch {}
        }
        return `- ${detail} — ${parts.join(', ') || 'text data'}`;
      }).join('\n')
    : 'No data files in workspace.';

  // Build existing workflows section so planner can use api.runWorkflow()
  const { getWorkflows } = await import("../index");
  const existingWorkflows = await getWorkflows(databaseId);
  const existingWorkflowsSection = existingWorkflows.length > 0
    ? existingWorkflows.map(w => `- "${w.name}"${w.description ? ` — ${w.description.split('\n')[0].replace(/^\*.*?\*\s*/, '').substring(0, 100)}` : ''}`).join('\n')
    : 'No existing workflows.';

  // Knowledge packs section — so the planner can route domain rules through
  // api.getKnowledge() instead of hard-coding them.
  const knowledgePacksSection = manifest.knowledgePacks.length > 0
    ? manifest.knowledgePacks
        .map(p => `- "${p.name}" (${p.scope})${p.tags.length ? ` [${p.tags.join(', ')}]` : ''}`)
        .join('\n')
    : 'No knowledge packs in workspace.';

  const concepts = loadConcepts(["tool-granularity", "variable-syntax", "builtin-tools", "report-authoring", "page-workflows", "email-tools", "api-reference"]);
  const mcpToolsSection = await buildMcpToolsSection();
  const systemPrompt = loadPrompt(plannerPrompt, { ...concepts, DATA_FILES: dataFilesSection, EXISTING_WORKFLOWS: existingWorkflowsSection, KNOWLEDGE_PACKS: knowledgePacksSection, SKILLS: buildUserRulesSection(databaseId), WIDGETS: widgetSchemasSection(), MCP_TOOLS: mcpToolsSection });

  // Build messages — include chat history if this is a re-plan with feedback
  const messages = [
    ...(chatHistory || []).slice(-4).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  // Log prompt for debugging
  try {
    const fs = await import("fs");
    const path = await import("path");
    const dir = "logs/LLM_prompts";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await cleanupOldLogs(dir, 10);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`${dir}/planner_${ts}_system.md`, systemPrompt);
    fs.writeFileSync(`${dir}/planner_${ts}_messages.json`, JSON.stringify(messages, null, 2));
  } catch {}

  const result = await callLLM("pipeline:plan", {
    systemPrompt,
    messages,
    responseFormat: "json",
    temperature: 0.3,
    maxTokens: 8192,
  });

  // Log response
  try {
    const fs = await import("fs");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(`logs/LLM_prompts/planner_response_${ts}.json`, JSON.stringify({
      timestamp: new Date().toISOString(), plan: result.data, usage: result.usage,
    }, null, 2));
  } catch {}

  const plan = result.data as BuildPlan;
  if (!plan || !plan.workflowName || !Array.isArray(plan.nodes)) {
    throw new Error("Planner LLM did not return a valid BuildPlan JSON");
  }

  const dataFileNames = manifest.dataFiles.map((f) => f.name);

  // Deterministically rewrite {{name}} references that fuzzy-match a known
  // source (data file, userMessage, or result) to the canonical spelling, so
  // LLM casing/underscore drift doesn't survive to run time.
  normalizePlanVariables(plan, dataFileNames);

  // Guardrail: flag node inputs that reference data files which aren't loaded.
  // This catches the common mistake of pasting raw CSVs into the New Workflow
  // box — the planner designs a workflow around data that was never loaded, then
  // the build wires steps that read nothing and fail at run time.
  const unresolvedInputs = findUnresolvedDataInputs(plan, dataFileNames);

  // Format the plan for the user to review
  const displayText = formatPlanForUser(plan, dataFilesSection, unresolvedInputs);

  return { plan, displayText, unresolvedInputs };
}

/**
 * Return the distinct `{{name}}` input sources referenced by the plan's nodes
 * that are genuinely missing — neither a loaded workspace data file, nor the
 * `userMessage` builtin, nor the `result` output that the run_MCP bridge
 * overwrites on each step.
 */
/** Canonical comparison key: case-insensitive, underscore/hyphen/space-insensitive. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]+/g, "");
}

/**
 * Deterministically rewrite `{{name}}` references that fuzzy-match a known
 * source (a data file, `userMessage`, or `result`) to the canonical spelling.
 * The planner LLM drifts on casing/underscores ("bankBalances" vs
 * "bank_balances"); this corrects close misses so the string-match contract
 * isn't the single point of failure. Ambiguous or genuinely-unmatched
 * references are left untouched for `findUnresolvedDataInputs` / the repair
 * loop to handle.
 */
function normalizePlanVariables(plan: BuildPlan, dataFileNames: string[]): void {
  const canonicalByKey = new Map<string, string>(); // norm → canonical ("" = ambiguous)
  const register = (name: string) => {
    const key = normName(name);
    if (!key) return;
    const existing = canonicalByKey.get(key);
    if (existing === undefined) canonicalByKey.set(key, name);
    else if (existing !== name) canonicalByKey.set(key, "");
  };

  for (const f of dataFileNames) register(f);
  register("userMessage");
  register("result");

  const resolveRef = (ref: string): string =>
    ref.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, name: string) => {
      const canonical = canonicalByKey.get(normName(name.trim()));
      return canonical ? `{{${canonical}}}` : match;
    });

  for (const n of plan.nodes ?? []) {
    if (!n.toolParameters) continue;
    for (const k of Object.keys(n.toolParameters)) {
      const v = n.toolParameters[k];
      if (typeof v === "string") n.toolParameters[k] = resolveRef(v);
    }
  }
  for (const c of plan.audit?.checks ?? []) {
    if (typeof c.reads === "string") c.reads = resolveRef(c.reads);
  }
}

function findUnresolvedDataInputs(plan: BuildPlan, dataFileNames: string[]): string[] {
  const availableData = new Set(dataFileNames.map(normName));
  // `workflow_start` always outputs `userMessage`, and the run_MCP bridge
  // overwrites `result` with each MCP step's output — both are legitimate
  // builtin sources that are neither data files nor produced by a plan tool.
  availableData.add(normName("userMessage"));
  availableData.add(normName("result"));

  const unresolved = new Set<string>();
  const check = (raw: string | undefined) => {
    const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec((raw || "").trim());
    if (!m) return;
    const name = m[1].trim();
    if (!name) return;
    if (availableData.has(normName(name))) return;
    unresolved.add(name);
  };

  for (const n of plan.nodes ?? []) {
    for (const v of Object.values(n.toolParameters ?? {})) {
      if (typeof v === "string") check(v);
    }
  }
  for (const c of plan.audit?.checks ?? []) check(c.reads);

  return Array.from(unresolved);
}

/**
 * Confirm every planned node's `toolId` resolves to a known tool (native or
 * MCP). Returns the list of unknown tool ids (with their node labels) so the
 * caller can fail loudly instead of wiring a node that can never run.
 * `workflow_start` / `workflow_end` are auto-created markers and always pass.
 */
async function validatePlanTools(plan: BuildPlan, databaseId: string): Promise<string[]> {
  const unknown: string[] = [];
  for (const node of plan.nodes) {
    if (node.toolId === "workflow_start" || node.toolId === "workflow_end") continue;
    const def = await getToolDefinition(node.toolId, databaseId);
    if (!def) unknown.push(`${node.toolId} (node "${node.label}")`);
  }
  return unknown;
}

function formatPlanForUser(
  plan: BuildPlan,
  dataFiles: string,
  unresolvedInputs: string[] = [],
): string {
  const lines: string[] = [];

  lines.push(`I found these data files in your workspace:\n${dataFiles}\n`);

  // Surface dangling data references before the plan so the user sees the
  // problem first — most commonly "I pasted data instead of loading it."
  if (unresolvedInputs.length > 0) {
    lines.push(
      `> ⚠️ **Heads up — this plan reads data that isn't in your workspace:** ` +
      unresolvedInputs.map(n => `\`${n}\``).join(', ') + `.\n` +
      `>\n` +
      `> If these are data files, **don't approve yet** — Cancel, load them in the ` +
      `**Data** section (or with \`/data-load\`), then build the workflow again. ` +
      `Otherwise it will build but fail at run time with nothing to read.\n` +
      `>\n` +
        `> *(Tip: paste raw CSVs into the Data section, not the New Workflow box.)*\n`,
    );
  }

  lines.push(`Here's my plan for the **${plan.workflowName}** workflow:\n`);

  // Node table
  lines.push('| # | Step | Tool | What it does |');
  lines.push('|---|------|------|-------------|');
  plan.nodes.forEach((node, i) => {
    lines.push(`| ${i + 1} | ${node.label} | ${node.toolId} | |`);
  });

  // Audit — show what success looks like
  if (plan.audit && plan.audit.checks.length > 0) {
    lines.push(`\n**Audit checks (what qualifies as correct):**`);
    lines.push(`> ${plan.audit.description}`);
    for (const check of plan.audit.checks) {
      lines.push(`- ✅ ${check.condition}`);
    }
  }

  lines.push(`\nReview the plan above and approve it, or tell me what to change.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Stage 2: WIRE WORKFLOW — deterministic, no LLM
// ---------------------------------------------------------------------------

async function stageWireWorkflow(
  plan: BuildPlan,
  databaseId: string,
  log: string[],
): Promise<string> {
  log.push("Wiring workflow...");

  const workflowName = plan.workflowName;
  const workflowDescription = plan.workflowDescription || "";

  const workflow = await createWorkflow(databaseId, workflowName, workflowDescription);
  if (!workflow) {
    throw new Error("Failed to create workflow");
  }
  const workflowId = workflow.id;

  // Diagnostic — confirm the workflow actually landed in the live session
  // that the workspace page reads from. If counts mismatch the user reports
  // a "blank workspace" after the build, look here.
  try {
    const verify = requireSessionByDatabaseId(databaseId);
    console.log(
      `[build] createWorkflow databaseId=${databaseId} workflowId=${workflowId} ` +
      `sessionWorkflowCount=${verify.getWorkflows().length} ` +
      `userId=${verify.userId} sessionDbId=${verify.databaseId}`,
    );
  } catch (e) {
    console.error(`[build] createWorkflow succeeded but session lookup failed:`, e);
  }

  // Extract a one-line summary from the description for the workflow list,
  // and apply the optional nav group (makes the workflow a left-nav "page").
  const summary = workflowDescription ? extractSummary(workflowDescription) : null;
  const group = plan.group?.trim() || undefined;
  if (summary || group) {
    const ws = requireSessionByDatabaseId(databaseId);
    const wf = ws.getWorkflow(workflowId);
    if (wf) {
      ws.upsertWorkflow({
        ...wf,
        ...(summary ? { summary } : {}),
        ...(group ? { group } : {}),
        updated_at: new Date().toISOString(),
      });
    }
  }

  // Add nodes in order (skip workflow_start — it's auto-created by createWorkflow)
  for (const node of plan.nodes) {
    if (node.toolId === "workflow_start") continue;

    await buildAddNode(databaseId, workflowId, {
      label: node.label,
      tool_id: node.toolId,
      toolParameters: node.toolParameters,
      chatMsgBody: node.chatMsgBody,
    });
  }

  // Enforce a terminal workflow_audit node (fail-closed audit) so every built
  // workflow ends with an audit that trigger adapters can read.
  await ensureTerminalAudit(databaseId, workflowId, log);

  log.push("  Done");
  return workflowId;
}

// ---------------------------------------------------------------------------
// Stage 3: INTEGRATION TEST — run full workflow
// ---------------------------------------------------------------------------

async function stageIntegrationTest(
  workflowId: string,
  databaseId: string,
  userId: string,
  log: string[],
): Promise<boolean> {
  if (!(await canAutoTest(databaseId, workflowId))) {
    log.push("Skipping integration test — workflow requires user input.");
    return true; // can't test, assume ok
  }

  log.push("Running integration test...");
  const result = await testWorkflow(databaseId, workflowId, userId);

  if (result.success) {
    log.push("  Integration test passed.");
    return true;
  }

  log.push(`  Integration test failed: ${result.errorDetail}`);
  return false;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format a millisecond duration for the build transcript. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Flip an in-flight progress spinner to a done checkmark, annotating elapsed time. */
function finalizeProgressMessage(msg: any, now: number): boolean {
  if (!(msg.id?.startsWith("build-progress-") && msg.json?.type === "progress")) return false;
  const startedAt = msg.json.startedAt ?? now;
  const elapsedMs = now - startedAt;
  const label = msg.json.label ?? msg.markdown ?? "";
  msg.html = `<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2"><span class="text-green-500">✓</span><span>${escapeHtml(label)}</span><span class="text-xs text-gray-400">· ${formatDuration(elapsedMs)}</span></div>`;
  msg.json.type = "progress-done";
  msg.json.elapsedMs = elapsedMs;
  return true;
}

/** Human label for a pipeline LLM source tag (e.g. "pipeline:tool_code:x"). */
function llmPhaseFromSource(source: string): string {
  if (source.startsWith("pipeline:plan")) return "plan";
  if (source.startsWith("pipeline:tool_code")) return "tool code";
  return source.replace(/^pipeline:/, "");
}

/** Push a progress message to a session (if sessionId provided) and notify SSE.
 *  Messages accumulate so the user sees a log of what happened, each annotated
 *  with its elapsed time once the next step starts. */
async function pushProgress(databaseId: string, sessionId: string | undefined, label: string, progressId: string): Promise<void> {
  if (!sessionId) return;
  try {
    const { getSession, saveSession } = await import("@backend/core/session/sessions/session_all");
    const { notifyClients } = await import("@backend/interfaces/streaming/simpleSSE");
    const session = await getSession(databaseId, sessionId);
    if (!session) return;
    const now = Date.now();
    // Finalize the previous in-flight step so its duration is captured.
    for (const msg of session.messages) {
      finalizeProgressMessage(msg, now);
    }
    session.messages.push({
      id: `build-progress-${progressId}-${now}`,
      role: "assistant",
      source: "build-agent",
      nodeLabel: "Building",
      html: `<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2"><div class="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500"></div><span>${escapeHtml(label)}</span></div>`,
      markdown: label,
      timestamp: new Date(),
      json: { type: "progress", startedAt: now, label },
    } as any);
    await saveSession(databaseId, session);
    notifyClients(sessionId, "new_message");
  } catch {}
}

/** Convert any remaining progress spinners to done checkmarks with elapsed time. */
async function clearProgressMessage(databaseId: string, sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    const { getSession, saveSession } = await import("@backend/core/session/sessions/session_all");
    const { notifyClients } = await import("@backend/interfaces/streaming/simpleSSE");
    const session = await getSession(databaseId, sessionId);
    if (!session) return;
    let changed = false;
    const now = Date.now();
    for (const msg of session.messages) {
      if (finalizeProgressMessage(msg, now)) changed = true;
    }
    if (changed) {
      await saveSession(databaseId, session);
      notifyClients(sessionId, "new_message");
    }
  } catch {}
}

/** Record one LLM call in the build session (phase + model + tokens + duration). */
async function pushLLMCall(
  databaseId: string,
  sessionId: string | undefined,
  source: string,
  model: string,
  usage: { inputTokens: number; outputTokens: number } | undefined,
  elapsedMs: number,
): Promise<void> {
  if (!sessionId) return;
  try {
    const { getSession, saveSession } = await import("@backend/core/session/sessions/session_all");
    const { notifyClients } = await import("@backend/interfaces/streaming/simpleSSE");
    const session = await getSession(databaseId, sessionId);
    if (!session) return;
    const phase = llmPhaseFromSource(source);
    const tokStr = usage ? `${usage.inputTokens}\u2192${usage.outputTokens} tok` : "";
    const parts = ["LLM call", phase, tokStr, formatDuration(elapsedMs)].filter(Boolean).join(" \u00b7 ");
    session.messages.push({
      id: `build-llm-${Date.now()}`,
      role: "assistant",
      source: "build-agent",
      html: `<div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-1">${parts}${model ? ` \u00b7 <span class="font-mono">${escapeHtml(model)}</span>` : ""}</div>`,
      markdown: `${parts}${model ? ` \u00b7 ${model}` : ""}`,
      timestamp: new Date(),
      json: { type: "llm-call", phase, model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, elapsedMs },
    } as any);
    await saveSession(databaseId, session);
    notifyClients(sessionId, "new_message");
  } catch {}
}

/** Write the full build log (tool names, retries, audit, test result) into the session. */
async function pushBuildLog(databaseId: string, sessionId: string | undefined, log: string[]): Promise<void> {
  if (!sessionId || !log || log.length === 0) return;
  try {
    const { getSession, saveSession } = await import("@backend/core/session/sessions/session_all");
    const { notifyClients } = await import("@backend/interfaces/streaming/simpleSSE");
    const session = await getSession(databaseId, sessionId);
    if (!session) return;
    const items = log.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
    session.messages.push({
      id: `build-log-${Date.now()}`,
      role: "assistant",
      source: "build-agent",
      html: `<details class="text-xs text-gray-500 dark:text-gray-400 py-1"><summary class="cursor-pointer select-none">Build log (${log.length} steps)</summary><ul class="mt-1 space-y-0.5 list-disc list-inside font-mono">${items}</ul></details>`,
      markdown: `## Build log\n\n${log.map((l) => `- ${l}`).join("\n")}`,
      timestamp: new Date(),
      json: { type: "build-log" },
    } as any);
    await saveSession(databaseId, session);
    notifyClients(sessionId, "new_message");
  } catch {}
}

export async function runBuildPipeline(params: BuildPipelineParams): Promise<BuildPipelineResult> {
  const { userMessage, databaseId, userId, llmConfig, approvedPlan, chatHistory, sessionId, plannerPrompt } = params;
  const log: string[] = [];
  const actionsExecuted: string[] = [];

  // Use the privacy-aware caller if provided, otherwise fall back to raw callLLM + logUsage
  const callLLM: LLMCaller = params.callLLM ?? (async (source, opts) => {
    const start = Date.now();
    const result = await rawCallLLM(llmConfig, opts);
    logUsage(databaseId, source, result.model, result.usage, {
      provider: llmConfig.provider,
      costUsd: result.costUsd,
    });
    await pushLLMCall(databaseId, sessionId, source, result.model, result.usage, Date.now() - start);
    return result;
  });

  // --- Stage 1: PLAN (if no approved plan provided) ---
  if (!approvedPlan) {
    setProgress(databaseId, "Planning workflow...");
    try {
      let planResult = await stagePlan(userMessage, databaseId, userId, callLLM, chatHistory, plannerPrompt);

      // Repair loop: a plan that references dangling {{name}} variables is fed
      // back to the planner with the exact offending names + the rule, then
      // re-planned (max 2 retries). If it still can't resolve them, fail hard
      // rather than build a workflow that will break at run time.
      const feedback: Array<{ role: string; content: string }> = [];
      for (let attempt = 0; attempt < 2 && planResult.unresolvedInputs.length > 0; attempt++) {
        const names = planResult.unresolvedInputs.map((n) => `{{${n}}}`).join(", ");
        feedback.push({
          role: "user",
          content: `The plan references unresolved variable(s): ${names}. Fix by referencing a loaded data file name, \`{{result}}\` (a prior step's output), or a literal. Never emit a {{name}} reference with no provider.`,
        });
        planResult = await stagePlan(userMessage, databaseId, userId, callLLM, [...(chatHistory ?? []), ...feedback], plannerPrompt);
        checkCancelled(databaseId);
      }

      if (planResult.unresolvedInputs.length > 0) {
        throw new Error(
          `Workflow plan still references unresolved variable(s): ${planResult.unresolvedInputs.map((n) => `"{{${n}}}"`).join(", ")}.`,
        );
      }

      return {
        text: planResult.displayText,
        log: ["Plan generated — waiting for user approval"],
        actionsExecuted: [],
        pendingPlan: planResult.plan,
        unresolvedInputs: planResult.unresolvedInputs,
      };
    } finally {
      clearProgress(databaseId);
    }
  }

  // --- Stages 2-4: BUILD, WIRE, TEST ---
  const plan = approvedPlan;

  try {
    // Defense-in-depth: reject a pre-approved plan that still carries dangling
    // {{name}} references (e.g. an old stored plan) before building anything.
    const validationManifest = await buildManifest(databaseId, userId);
    const dangling = findUnresolvedDataInputs(plan, validationManifest.dataFiles.map((f) => f.name));
    if (dangling.length > 0) {
      throw new Error(
        `Workflow plan references unresolved variable(s): ${dangling.map((n) => `"{{${n}}}"`).join(", ")}. Re-plan the workflow.`,
      );
    }

    // Defense-in-depth: reject any node whose tool doesn't resolve to a known
    // native/MCP tool (catches stale `custom:` references or unknown ids).
    const unknownTools = await validatePlanTools(plan, databaseId);
    if (unknownTools.length > 0) {
      throw new Error(
        `Workflow plan references unknown tool(s): ${unknownTools.join(", ")}. Re-plan the workflow.`,
      );
    }

    // Stage 2: Wire workflow
    checkCancelled(databaseId);
    setProgress(databaseId, "Wiring workflow...");
    await pushProgress(databaseId, sessionId, "Wiring workflow...", "wire");
    const workflowIdResolved = await stageWireWorkflow(plan, databaseId, log);
    actionsExecuted.push("workflow.create", ...plan.nodes.map(() => "workflow.addNode"));

    // Changelog: record initial creation
    appendChangelog(databaseId, workflowIdResolved, `Workflow created — ${plan.nodes.length} steps`);

    // Stage 3: Integration test
    checkCancelled(databaseId);
    setProgress(databaseId, "Running integration test...");
    await pushProgress(databaseId, sessionId, "Running integration test...", "test");
    const testPassed = await stageIntegrationTest(workflowIdResolved, databaseId, userId, log);

    const builtName = plan.workflowName;
    const builtDescription = plan.workflowDescription;
    // Pull the concrete integration-test failure out of the log so the caller
    // (chat or UI) can show the real error rather than a generic "found issues".
    const failedDetail = [...log].reverse().find((l) => l.startsWith("  Integration test failed"));
    const statusLine = testPassed
      ? `Built **${builtName}** — ${plan.nodes.length} steps. Tested and ready to run.`
      : `Built **${builtName}** but the integration test found issues.${failedDetail ? `\n\n${failedDetail}` : ` Run the workflow and use "Analyse Run" to investigate.`}`;

    const text = builtDescription
      ? `${statusLine}\n\n---\n\n${builtDescription}`
      : statusLine;

    // Diagnostic — final session state right before we return success.
    try {
      const verify = requireSessionByDatabaseId(databaseId);
      console.log(
        `[build] pipeline complete databaseId=${databaseId} ` +
        `workflows=${verify.getWorkflows().length} tools=${verify.getTools().length} ` +
        `data=${verify.getDataNames().length} returnedWorkflowId=${workflowIdResolved}`,
      );
    } catch (e) {
      console.error(`[build] pipeline complete — session lookup failed:`, e);
    }

    return {
      text,
      log,
      actionsExecuted,
      workflowId: workflowIdResolved,
    };
  } catch (err: any) {
    // Attach the accumulated build log so callers can surface what happened
    // instead of leaving the user with a bare error.
    err.buildLog = log;
    throw err;
  } finally {
    clearProgress(databaseId);
    await clearProgressMessage(databaseId, sessionId);
    await pushBuildLog(databaseId, sessionId, log);
  }
}
