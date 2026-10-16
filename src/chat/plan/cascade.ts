/**
 * cascade planner — a shape registry. Jev classifies the request's *shape*
 * (one fan-out of narrow nouls, derived from the registry below) and picks the
 * data file; deterministic code assembles each shape's template; a single
 * scoped LLM call fills only the free-text args (group_by, judge instructions,
 * report title). Jev never generates the plan — it only gates its shape.
 *
 * Shapes are declarative: each entry declares the nouls that classify it, a
 * matcher that decides whether it owns the request, and a builder that emits
 * the plan. The classifier fan-out and the dispatch loop are both derived from
 * this table, so adding a shape = adding one entry (no if/else chains, no
 * classifier edits). Shapes that can't be templated yet simply don't match and
 * the orchestrator falls back to the LLM planner / build loop.
 *
 * External (non-internal) MCP servers are not present today, but the registry
 * is the extension point for them: a runtime connection can `registerShape()`
 * a `ShapeDef` whose `build` emits a plan over that server's tools (typically
 * LLM-assembled) — the same classify → match → build → validate pipeline
 * applies without code changes elsewhere.
 */

import { askClassifier } from "@shared/typesafe/openRouter";
import type { ChoiceAnswer, NoulAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { z } from "zod";
import { callStructured } from "@backend/core/llm/structured";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { resolveDataName } from "./args";
import { getToolParams } from "../extract/schema";
import { extractParams } from "../extract/extract";
import type { NodePlan, PlanStep } from "./types";
import type { Planner, PlanRequest, PlanResult } from "./planner";

/** Classifier noul answers, keyed by noul id. */
type Flags = Record<string, boolean>;

/** Per-request context shared across shapes (currently just the data-file pick). */
interface ShapeContext {
  dataFile: string | null;
}

/** A declarative shape: how to classify it, when it owns the request, and how
 *  to build its plan. */
interface ShapeDef {
  id: string;
  /** Dispatch order — higher priority wins when multiple shapes match. */
  priority: number;
  /** Classification fan-out: noul id → instructions. */
  nouls: Record<string, string>;
  /** True when this shape owns the request, given all classified flags. */
  matches: (flags: Flags) => boolean;
  /** Assemble the plan (or return `fallback`). */
  build: (req: PlanRequest, flags: Flags, ctx: ShapeContext) => Promise<PlanResult>;
}

interface AnalysisArgs {
  group_by?: string[];
  measures?: { column: string; fn: string }[];
  checks?: { id: string; question: string }[];
  title?: string;
  detail_columns?: string[];
}

const AnalysisArgsSchema = z.object({
  group_by: z.array(z.string()).optional(),
  measures: z.array(z.object({ column: z.string(), fn: z.string() })).optional(),
  checks: z.array(z.object({ id: z.string(), question: z.string() })).optional(),
  title: z.string().optional(),
  detail_columns: z.array(z.string()).optional(),
});

const N = 0.5; // noul → boolean threshold
const DATA_NONE_SENTINEL = "__none__";

/** True when the request back-references the prior turn's result. */
function referencesPrior(rawMessage: string): boolean {
  const t = rawMessage.toLowerCase();
  // Back-reference nouns — clearly about the prior turn's result.
  if (
    /\b(the (findings|results|analysis|summary|report|issues)|these (findings|results|issues)|those (findings|results|issues))\b/.test(
      t,
    )
  ) {
    return true;
  }
  // Demonstratives referring to the prior output ("put this into…", "it"),
  // unless time-scoped ("this year", "this month" — a fresh scope, not a follow-up).
  return (
    /\b(this|that|these|those|it)\b/.test(t) &&
    !/\b(this|that)\s+(year|month|quarter|week|day|period|fiscal|ytd)\b/.test(t)
  );
}

/** The workspace's loaded data files, name + columns. */
function dataInventory(databaseId: string): { name: string; columns: string[] }[] {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return [];
    return ws.getDataNames().map((name: string) => {
      const e = ws.getDataEntry(name);
      return { name, columns: Array.isArray(e?.columns) ? (e.columns as string[]) : [] };
    });
  } catch {
    return [];
  }
}

/** One scoped LLM call fills only the free-text analysis args. */
async function llmFillAnalysisArgs(
  req: PlanRequest,
  source: string,
  columns: string[],
  flags: Flags,
): Promise<AnalysisArgs> {
  const wanted: string[] = [];
  if (flags.aggregate || flags.report) wanted.push("group_by", "measures");
  if (flags.judge) wanted.push("checks");
  if (flags.report) wanted.push("title", "detail_columns");

  const system =
    "You fill the arguments for a deterministic data-analysis pipeline as a single JSON object. " +
    "Return ONLY JSON. Use only the request and the column list — do not invent values or columns. " +
    'Where requested: "group_by" is an array of categorical column names to group by, "measures" is an ' +
    'array of {column, fn} with fn one of "sum"/"count"/"avg"/"min"/"max" over numeric columns, ' +
    '"checks" is an array of {id, question} with 3-5 broad yes/no questions about the DATASET as a whole ' +
    '(e.g. {id:"missing_gl_account", question:"Are any rows missing a GL Account?"}) — not per-row questions, ' +
    '"title" is a short report title, and "detail_columns" is an array of columns to show in the drill-down.';

  const user =
    `User request: ${req.rawMessage}\n` +
    `Data file: ${source}\n` +
    `Columns: ${columns.join(", ")}\n\n` +
    `Return a JSON object with these keys (omit any that do not apply): ${wanted.join(", ")}.`;

  const res = await callStructured({
    databaseId: req.databaseId,
    schema: AnalysisArgsSchema,
    toolName: "emit_analysis_args",
    toolDescription: "Emit the analysis arguments as a JSON object matching the schema.",
    system,
    userMessage: user,
    maxTokens: 1500,
    temperature: 0,
    callOpts: { userId: req.userId, mode: "chat", phase: "plan-args" },
  });

  return res ?? {};
}

/** Deterministic required-arg check for a single step. */
async function stepMissing(
  toolId: string,
  params: Record<string, unknown>,
): Promise<string[]> {
  const toolParams = await getToolParams(toolId);
  return toolParams
    .filter((p) => p.required && params[p.name] === undefined)
    .map((p) => p.name);
}

/** Classify a QBO statement request as P&L vs Balance Sheet (deterministic). */
function qboStatementType(raw: string): "pnl" | "balance_sheet" | null {
  const t = raw.toLowerCase();
  if (/\b(p&l|pnl|profit\s*&?\s*loss|income\s*statement|income\s+by)\b/.test(t)) {
    return "pnl";
  }
  if (/\b(balance\s*sheet|statement\s+of\s+financial\s+position)\b/.test(t)) {
    return "balance_sheet";
  }
  return null;
}

/** True when the request asks to save the result into durable workspace data. */
function wantsSaveToData(raw: string): boolean {
  const t = raw.toLowerCase();
  return /\bsave\b/.test(t) && /\b(data|workspace|persist|store)\b/.test(t);
}

/** Map a QBO targeted-read request to its read tool id (deterministic). */
function qboReadTool(raw: string): string | null {
  const t = raw.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(gl review|general ledger|misclassif|trial balance)\b/, "qbo_gl_review"],
    [/\b(receivab|payab|aging|unpaid)\b/, "qbo_ar_ap"],
    [/\bduplicat\b/, "qbo_duplicates"],
    [/\brecurring\b/, "qbo_recurring_check"],
    [/\buncategoriz\b/, "qbo_uncategorized"],
    [/\bchart\s+of\s+accounts\b/, "qbo_accounts_list"],
    [/\bcustomers?\b/, "qbo_customers_list"],
    [/\bvendors?\b/, "qbo_vendors_list"],
    [/\binvoices?\b/, "qbo_invoices_list"],
    [/\bbills?\b/, "qbo_bills_list"],
    [/\bclasses?\b/, "qbo_classes_list"],
    [/\b(locations?|departments?)\b/, "qbo_locations_list"],
    [/\baccounts?\b/, "qbo_accounts_list"],
  ];
  for (const [re, tool] of rules) {
    if (re.test(t)) return tool;
  }
  return null;
}

/** Default comparison version for a budget-vs-actual request. */
function planningCompareVersion(raw: string): string {
  const t = raw.toLowerCase();
  if (/\bforecast\b/.test(t)) return "Forecast";
  if (/\blatest\s+estimate\b/.test(t)) return "Latest estimate";
  if (/\bbudget\s*2\b/.test(t)) return "budget2";
  return "budget1";
}

/** QBO statement → report_qbo_pnl / report_qbo_bs → chat_download. */
async function qboStatementPlan(
  req: PlanRequest,
  stmt: "pnl" | "balance_sheet",
): Promise<PlanResult> {
  const toolId = stmt === "pnl" ? "report_qbo_pnl" : "report_qbo_bs";
  const params = await getToolParams(toolId);
  const { values } = extractParams(toolId, req.rawMessage, params, req.clarifiedParams);

  const start_date = values.start_date;
  const end_date = values.end_date;
  if (typeof start_date !== "string" || typeof end_date !== "string") {
    return {
      kind: "clarify",
      missing: [`${toolId}.start_date`, `${toolId}.end_date`],
      question:
        stmt === "pnl"
          ? 'For the Profit & Loss, which date range should I use? (e.g. "2026-01-01 to 2026-09-30", or "this year to date")'
          : 'For the balance sheet, which date should I use? (e.g. "as of 2025-12-31" or "as of last month end")',
    };
  }

  const tp: Record<string, unknown> = { start_date, end_date };
  if (typeof values.summarize_column_by === "string") {
    tp.summarize_column_by = values.summarize_column_by;
  }
  if (typeof values.accounting_method === "string") {
    tp.accounting_method = values.accounting_method;
  }
  // "save it to data" → persist the structured statement rows alongside the HTML.
  if (wantsSaveToData(req.rawMessage)) {
    const year = start_date.slice(0, 4);
    tp.save_to =
      stmt === "pnl" ? `chat_qbo_pnl_${year}` : `chat_qbo_balance_sheet_${year}`;
  }

  const steps: PlanStep[] = [
    {
      tool_id: toolId,
      tool_parameters: tp,
      label: stmt === "pnl" ? "Fetch QBO P&L" : "Fetch QBO Balance Sheet",
    },
    {
      tool_id: "chat_download",
      tool_parameters: { data: "{{result}}", filename: "report.html" },
      label: "Download report",
    },
  ];
  return { kind: "plan", plan: { steps }, missingRequired: [] };
}

/** QBO targeted read → single read tool (summarized by the plan renderer). */
async function qboReadPlan(req: PlanRequest, toolId: string): Promise<PlanResult> {
  const params = await getToolParams(toolId);
  const { values } = extractParams(toolId, req.rawMessage, params, req.clarifiedParams);
  const missing = params
    .filter((p) => p.required && values[p.name] === undefined)
    .map((p) => p.name);
  if (missing.length > 0) {
    return {
      kind: "clarify",
      missing: missing.map((m) => `${toolId}.${m}`),
    };
  }
  const steps: PlanStep[] = [
    { tool_id: toolId, tool_parameters: values, label: toolId },
  ];
  return { kind: "plan", plan: { steps }, missingRequired: [] };
}

/** Planning variance report → report_plan_variance → chat_download. */
async function planningVariancePlan(req: PlanRequest): Promise<PlanResult> {
  const toolId = "report_plan_variance";
  const params = await getToolParams(toolId);
  const { values } = extractParams(toolId, req.rawMessage, params, req.clarifiedParams);

  if (typeof values.fy !== "number") {
    return {
      kind: "clarify",
      missing: ["report_plan_variance.fy"],
      question:
        'Which fiscal year should I compare? (e.g. "FY2026" or "2026")',
    };
  }

  const tp: Record<string, unknown> = {
    fy: values.fy,
    base: typeof values.base === "string" ? values.base : "actuals",
    compare:
      typeof values.compare === "string"
        ? values.compare
        : planningCompareVersion(req.rawMessage),
  };
  if (typeof values.title === "string") tp.title = values.title;

  const steps: PlanStep[] = [
    {
      tool_id: "report_plan_variance",
      tool_parameters: tp,
      label: "Build budget-vs-actual report",
    },
    {
      tool_id: "chat_download",
      tool_parameters: { data: "{{result}}", filename: "budget-variance.html" },
      label: "Download report",
    },
  ];
  return { kind: "plan", plan: { steps }, missingRequired: [] };
}

/** True when the request asks for a bespoke/custom dashboard or chart layout —
 *  beyond what the fixed `report_table` drill-down template can express. Such
 *  requests defer to the LLM build loop (which authors HTML per the
 *  report-authoring skill). */
function isBespokeRequest(raw: string): boolean {
  return /(dashboard|chart|graph|visuali[sz]ation|bespoke|\bcustom\s+(dashboard|report|html|page|view|layout|graph|chart))\b/i.test(
    raw,
  );
}

/** True when the request is an error/audit check rather than a summarization. */
function isCheckRequest(raw: string): boolean {
  return /\b(errors?|issues?|reconcile|validate|audit|mismatch|unbalanced|missing|unreviewed|flag)\b/i.test(
    raw,
  );
}

/** True when the request explicitly asks to aggregate/summarize. */
function isExplicitAggregation(raw: string): boolean {
  return /\b(sum|total|aggregate|group\s+by|average|avg|count|subtotal|breakdown)\b/i.test(raw);
}

/** Analysis over loaded workspace data → aggregate/judge → report → download. */
async function analysisPlan(
  req: PlanRequest,
  flags: Flags,
  ctx: ShapeContext,
): Promise<PlanResult> {
  // Bespoke dashboards/charts are generative — defer to the LLM build loop.
  if (flags.bespoke || isBespokeRequest(req.rawMessage)) {
    return { kind: "fallback", reason: "bespoke report — defer to build loop", preferLoop: true };
  }

  const inventory = dataInventory(req.databaseId);

  // Follow-ups always reuse the prior turn's source (and saved summary).
  const followUp = referencesPrior(req.rawMessage);
  const last = req.analysisHistory?.[0];
  const source = followUp && last?.source
    ? last.source
    : (ctx.dataFile ?? resolveDataName(req.rawMessage, inventory.map((d) => ({ name: d.name }))));
  if (!source) return { kind: "fallback", reason: "no data source resolved" };
  const entry = inventory.find((d) => d.name === source);
  const columns = entry?.columns ?? [];

  const reuseSummary = followUp && last?.savedSummary ? last.savedSummary : null;

  const steps: PlanStep[] = [];

  if (reuseSummary) {
    // Report the already-saved summary (skip re-reading / re-aggregating).
    if (!flags.report) {
      return { kind: "fallback", reason: "follow-up reuse without report not templated" };
    }
    const args = await llmFillAnalysisArgs(req, source, columns, flags);
    // Reuse the prior aggregation's grouping so the join keys match the summary.
    const gb = last?.groupBy?.length ? last.groupBy : (args.group_by ?? []);
    const rp: Record<string, unknown> = { summary: reuseSummary, details: source };
    if (gb.length) rp.group_by = gb;
    if (args.detail_columns?.length) rp.detail_columns = args.detail_columns;
    if (args.title) rp.title = args.title;
    steps.push({ tool_id: "report_table", tool_parameters: rp, label: "Build report" });
    steps.push({
      tool_id: "chat_download",
      tool_parameters: { data: "{{result}}", filename: "report.html" },
      label: "Download report",
    });
  } else {
    // A report needs a summary table — aggregate whenever report is requested.
    // But an error/audit check ("analyze for errors", "reconcile", "validate")
    // is a judge task, not a summarization: skip the aggregate+save unless the
    // request explicitly asks to total/group by something.
    const checkOnly = isCheckRequest(req.rawMessage) && !isExplicitAggregation(req.rawMessage);
    const doAggregate = checkOnly ? false : (flags.aggregate || flags.report);
    const args = await llmFillAnalysisArgs(req, source, columns, flags);

    const staging = `staging_${source}_summary`.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    steps.push({ tool_id: "get_data", tool_parameters: { name: source }, label: "Read data" });

    if (doAggregate) {
      const tp: Record<string, unknown> = { name: source };
      if (args.group_by?.length) tp.group_by = args.group_by;
      if (args.measures?.length) tp.measures = args.measures;
      steps.push({ tool_id: "aggregate_data", tool_parameters: tp, label: "Summarize" });

      // Persist the aggregate summary immediately so {{result}} is the aggregate
      // (not a later judge step) and a follow-up report can reuse it.
      if (flags.report || flags.persist) {
        steps.push({
          tool_id: "save_data",
          tool_parameters: { name: staging, value: "{{result}}", type: "json_array" },
          label: "Save summary",
        });
      }
    }

    if (flags.judge) {
      const checks = args.checks ?? [];
      steps.push({
        tool_id: "check_data",
        tool_parameters: { name: source, checks },
        label: "Check issues",
      });
    }

    if (flags.report && doAggregate) {
      const rp: Record<string, unknown> = { summary: staging, details: source };
      if (args.group_by?.length) rp.group_by = args.group_by;
      if (args.detail_columns?.length) rp.detail_columns = args.detail_columns;
      if (args.title) rp.title = args.title;
      steps.push({ tool_id: "report_table", tool_parameters: rp, label: "Build report" });
      steps.push({
        tool_id: "chat_download",
        tool_parameters: { data: "{{result}}", filename: "report.html" },
        label: "Download report",
      });
    }
  }

  // Fail closed: any unresolved required arg → defer to the LLM planner.
  const missingRequired: string[] = [];
  for (const s of steps) {
    for (const m of await stepMissing(s.tool_id, s.tool_parameters)) {
      missingRequired.push(`${s.tool_id}.${m}`);
    }
  }
  if (missingRequired.length > 0) {
    return { kind: "fallback", reason: `missing required: ${missingRequired.join(", ")}` };
  }

  const plan: NodePlan = { steps };
  return { kind: "plan", plan, missingRequired: [] };
}

// ── Shape registry ──────────────────────────────────────────────────────────
// Dispatch order is priority (descending). The classifier fan-out and the
// dispatch loop in `plan()` are both derived from this table.

const SHAPES: ShapeDef[] = [
  {
    id: "qbo-statement",
    priority: 100,
    nouls: {
      qbo_statement:
        "Does this request ask for a QuickBooks Online financial statement (Profit & Loss / income statement, or Balance Sheet)?",
    },
    matches: (f) => f.qbo_statement,
    build: async (req) => {
      const stmt = qboStatementType(req.rawMessage);
      if (!stmt) return { kind: "fallback", reason: "qbo statement type unresolved" };
      return qboStatementPlan(req, stmt);
    },
  },
  {
    id: "qbo-read",
    priority: 100,
    nouls: {
      qbo_read:
        "Does this request ask for a targeted QuickBooks Online analysis or a list (GL review, AR/AP aging, duplicates, recurring expense gaps, uncategorized transactions, or an accounts/customers/vendors/invoices/bills/classes/locations list)?",
    },
    matches: (f) => f.qbo_read,
    build: async (req) => {
      const toolId = qboReadTool(req.rawMessage);
      if (!toolId) return { kind: "fallback", reason: "qbo read tool unresolved" };
      return qboReadPlan(req, toolId);
    },
  },
  {
    id: "planning-variance",
    priority: 100,
    nouls: {
      planning_report:
        "Does this request ask for a budget-vs-actual variance report or comparison?",
    },
    matches: (f) => f.planning_report,
    build: async (req) => planningVariancePlan(req),
  },
  {
    id: "analysis",
    priority: 0,
    nouls: {
      aggregate:
        "Does this request need to aggregate/summarize data — group by a column and compute sum/count/avg (e.g. 'total X by Y')? Error-checking/audit requests are NOT aggregation.",
      judge:
        "Does this request need a yes/no check over the whole dataset (e.g. 'are any rows missing a GL Account?')?",
      report:
        "Does this request ask for a report, dashboard, or downloadable file as the outcome?",
      bespoke:
        "Does this request ask for a custom/bespoke dashboard, chart, or visualization layout that a fixed drill-down table template cannot express?",
      persist: "Should the result be saved to the workspace as durable data?",
    },
    matches: (f) => f.aggregate || f.report || f.judge || f.bespoke,
    build: (req, flags, ctx) => analysisPlan(req, flags, ctx),
  },
];

SHAPES.sort((a, b) => b.priority - a.priority);

/** Register an additional shape at runtime (e.g. for a non-internal MCP server's
 *  tools). Re-sorts so priority order is preserved. */
export function registerShape(shape: ShapeDef): void {
  SHAPES.push(shape);
  SHAPES.sort((a, b) => b.priority - a.priority);
}

/** Stage 1 — one Jev fan-out classifies every shape's nouls and (when data is
 *  loaded) picks the data file to read. The question set is derived from the
 *  registry so adding a shape needs no change here. */
async function classify(
  req: PlanRequest,
): Promise<{ flags: Flags; dataFile: string | null }> {
  const key = await getClassifierKey(req.userId);

  let privacyMap = loadPrivacyMap(req.databaseId);
  const probe = { system: "", messages: [{ role: "user", content: req.rawMessage }] };
  const { added } = discoverRequestValues(req.databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(req.databaseId);

  const inventory = dataInventory(req.databaseId);

  const state = {
    request: privacyMap ? maskText(req.rawMessage, privacyMap) : req.rawMessage,
    data_files: inventory.map((d) =>
      d.columns.length ? `${d.name} (${d.columns.join(", ")})` : d.name,
    ),
  };

  const questions: Record<string, Question> = {};
  for (const shape of SHAPES) {
    for (const [id, instructions] of Object.entries(shape.nouls)) {
      questions[id] = { type: "noul", instructions };
    }
  }

  if (inventory.length > 0) {
    const dataCriteria: Record<string, string> = {};
    for (const d of inventory) {
      dataCriteria[d.name] = d.columns.length ? `columns: ${d.columns.join(", ")}` : "(no columns)";
    }
    dataCriteria[DATA_NONE_SENTINEL] = "This request does not read a loaded data file.";
    questions.data_file = {
      type: "choice",
      instructions:
        `Which loaded data file should this request read? Pick the file that matches; ` +
        `if none, choose "${DATA_NONE_SENTINEL}".`,
      criteria: dataCriteria,
    };
  }

  const { response } = await askClassifier(state, questions, { apiKey: key });
  const noul = (name: string) => (response.answers[name] as NoulAnswer).noul >= N;

  const flags: Flags = {};
  for (const shape of SHAPES) {
    for (const id of Object.keys(shape.nouls)) flags[id] = noul(id);
  }

  let dataFile: string | null = null;
  const dataAnswer = response.answers.data_file as ChoiceAnswer | undefined;
  if (dataAnswer && inventory.length > 0) {
    const top = Object.entries(dataAnswer.probabilities ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, prob]) => ({ name, prob }))[0];
    if (top && top.name !== DATA_NONE_SENTINEL && top.prob >= 0.2) dataFile = top.name;
  }

  return { flags, dataFile };
}

export const cascadePlanner: Planner = {
  id: "cascade",
  async plan(req: PlanRequest): Promise<PlanResult> {
    const { flags, dataFile } = await classify(req);
    const ctx: ShapeContext = { dataFile };

    // Deterministic QBO statement gate — a balance-sheet / P&L request must
    // resolve to report_qbo_bs/pnl (or ask for its date), never fall through to
    // a read tool or an LLM guessing the "as of" date.
    const stmt = qboStatementType(req.rawMessage);
    if (stmt) {
      return await qboStatementPlan(req, stmt);
    }

    for (const shape of SHAPES) {
      if (shape.matches(flags)) {
        return await shape.build(req, flags, ctx);
      }
    }

    return { kind: "fallback", reason: "no shape matched" };
  },
};
