/**
 * Node-plan composer — Jev selects the ordered steps, the deterministic
 * extractor fills their arguments.
 *
 * The composer asks Jev one `choice` question per step ("which tool runs
 * next, or are we done?") over the fixed component roster, then fills the
 * selected tool's arguments with `getToolParams` + `extractParams`. Data-file
 * references (e.g. `get_data(name=…)`) are resolved against the workspace's
 * data inventory so a plan reads the tables the user actually loaded. No code
 * is generated; the plan is an ordered list of pre-built tools + resolved args.
 */

import { askClassifier } from "@shared/typesafe/openRouter";
import type { ChoiceAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { aggregator } from "@mcp/aggregator";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { z } from "zod";
import { callStructured } from "@backend/core/llm/structured";
import { getToolParams, getToolSchema, type JsonSchema } from "../extract/schema";
import { extractParams } from "../extract/extract";
import { synthesizeStructuredArgs, resolveDataName } from "./args";
import { saveTypeFor } from "./outputs";
import { loadAppSkills } from "../../core/skills/loader";
import type { ComposeResult, NodePlan, PlanStep } from "./types";

const DONE_SENTINEL = "__done__";
const DATA_NONE_SENTINEL = "__none__";

/** Tools Jev must never compose (routing + workflow/rule build-time CRUD). */
const NON_COMPOSABLE = new Set([
  "select_skill", "list_skills",
  "create_workflow", "update_workflow", "delete_workflow",
  "add_node", "update_node", "delete_node", "reorder_nodes",
  "create_rule", "update_rule", "delete_rule",
]);

/** Read tools whose `name`-like parameter refers to a workspace data entry. */
const DATA_READ_TOOLS = new Set([
  "get_data", "aggregate_data", "check_data", "judge_data", "resolve_data_shape",
]);

/** Parameter names that reference a workspace data entry on data-read tools. */
const DATA_NAME_KEYS = new Set(["name", "data", "table", "table_name", "data_name", "source"]);

/** Parameter names that typically consume a prior step's output. When such a
 *  required input can't be resolved from the request text or the data inventory,
 *  it is wired to `{{result}}` — the run_MCP bridge's output parameter, which
 *  each MCP step overwrites, so `{{result}}` always means "the previous step's
 *  output". */
const OUTPUT_REF_KEYS = new Set([
  "value", "data", "items", "rows", "content", "html", "body", "text",
]);

export interface ComposeOptions {
  databaseId: string;
  userId: string;
  rawMessage: string;
  /** Candidate components Jev may choose from. Defaults to the live MCP roster
   *  minus routing/build-time CRUD tools. */
  tools?: { name: string; description: string }[];
  /** Prior-turn request text, for follow-up continuity. */
  lastRequest?: string;
  /** Active skill names (post-routing). Used to inject a condensed planning
   *  hint (their `## Rules`) into the classifier state. */
  activeSkills?: string[];
  /** Hard cap on steps. */
  maxSteps?: number;
}

const NEXT_TOOL_THRESHOLD = 0.3;
const DATA_FILE_THRESHOLD = 0.2;

/** Live roster of composable components (name → description). */
async function defaultRoster(): Promise<{ name: string; description: string }[]> {
  const tools = await aggregator.getAllTools();
  return tools
    .filter((t: any) => !NON_COMPOSABLE.has(t.name))
    .map((t: any) => ({ name: t.name, description: t.description || "" }));
}

/** A light human label for a step (the tool name is a fine fallback). */
function stepLabel(toolId: string): string {
  return toolId;
}

/** Extract the `## Rules` section from a skill's markdown body (short —
 *  encodes the delivery/format contract without the long recipe + CSS). */
function skillRules(content: string): string {
  const m = content.match(/## Rules\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  return m ? m[1].trim() : "";
}

/** Condensed planning hint from the active skills: name + their `## Rules`.
 *  Left unmasked (like the tool criteria) — skill text is not user data. */
function buildSkillHints(databaseId: string, activeSkills?: string[]): { name: string; rules: string }[] {
  if (!activeSkills || activeSkills.length === 0) return [];
  try {
    const skills = loadAppSkills(databaseId);
    const byName = new Map(skills.map((s) => [s.name, s.content]));
    const hints: { name: string; rules: string }[] = [];
    for (const name of activeSkills) {
      const content = byName.get(name);
      if (!content) continue;
      const rules = skillRules(content);
      if (rules) hints.push({ name, rules });
    }
    return hints;
  } catch {
    return [];
  }
}

/** The workspace's loaded data files, as a compact name + detail list. */
function buildDataInventory(databaseId: string): { name: string; detail: string }[] {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return [];
    return ws.getDataNames().map((name: string) => {
      const e = ws.getDataEntry(name);
      const parts: string[] = [];
      if (e?.content_type && e.content_type !== "text") parts.push(e.content_type.toUpperCase());
      if (e?.row_count != null) parts.push(`${e.row_count} rows`);
      if (e?.columns?.length) parts.push(`columns: ${e.columns.join(", ")}`);
      return { name, detail: parts.join(", ") };
    });
  } catch {
    return [];
  }
}

/** Columns of a loaded data file, for structured-arg synthesis. */
function getDataColumns(databaseId: string, name: string): string[] {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return [];
    const e = ws.getDataEntry(name);
    return Array.isArray(e?.columns) ? e.columns : [];
  } catch {
    return [];
  }
}

const FILL_SYSTEM =
  "You fill missing tool arguments as JSON. Return a single JSON object keyed by " +
  "parameter name. Use only the provided request and columns; do not invent values. " +
  "Arrays and objects must match the described shape exactly.";

const ArgFillSchema = z.record(z.string(), z.unknown());

/** Fill still-missing structured args with one small LLM JSON call. */
async function llmFillStructuredArgs(opts: {
  databaseId: string;
  userId: string;
  toolId: string;
  rawMessage: string;
  columns: string[];
  schema: JsonSchema;
  missing: { name: string; description?: string; type: string }[];
}): Promise<Record<string, unknown>> {
  if (opts.missing.length === 0) return {};

  const props = opts.schema?.properties ?? {};
  const shape = opts.missing
    .map((m) => {
      const sub = props[m.name];
      return `- ${m.name}${m.description ? `: ${m.description}` : ""}` +
        (sub ? `\n  schema: ${JSON.stringify(sub)}` : ` (type ${m.type})`);
    })
    .join("\n");
  const columnList = opts.columns.length
    ? `Available columns in the data file: ${opts.columns.join(", ")}.`
    : "";

  const today = new Date().toISOString().slice(0, 10);
  const userMessage =
    `Today's date: ${today}\nTool: ${opts.toolId}\nUser request: ${opts.rawMessage}\n${columnList}\n\n` +
    `Fill these missing arguments as a JSON object:\n${shape}\n\nReturn only JSON.`;

  const parsed = await callStructured({
    databaseId: opts.databaseId,
    schema: ArgFillSchema,
    toolName: "emit_arg_fill",
    toolDescription: "Emit the filled tool arguments as a JSON object matching the schema.",
    system: FILL_SYSTEM,
    userMessage,
    maxTokens: 1000,
    temperature: 0,
    callOpts: { userId: opts.userId, mode: "chat", phase: "arg-fill" },
  });

  return parsed ?? {};
}

export async function composePlan(opts: ComposeOptions): Promise<ComposeResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const tools = opts.tools ?? (await defaultRoster());
  const inventory = buildDataInventory(opts.databaseId);

  const toolCriteria: Record<string, string> = {};
  for (const t of tools) toolCriteria[t.name] = t.description || "(no description)";
  toolCriteria[DONE_SENTINEL] = "No further steps are needed — the workflow is complete.";

  // ── Privacy: mask user-derived text before it leaves the machine ──────
  let privacyMap = loadPrivacyMap(opts.databaseId);
  const probe = {
    system: "",
    messages: [
      { role: "user", content: opts.rawMessage },
      ...(opts.lastRequest ? [{ role: "user", content: opts.lastRequest }] : []),
    ],
  };
  const { added } = discoverRequestValues(opts.databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(opts.databaseId);

  const state: Record<string, unknown> = {
    today: new Date().toISOString().slice(0, 10),
    request: privacyMap ? maskText(opts.rawMessage, privacyMap) : opts.rawMessage,
    lastRequest: opts.lastRequest
      ? (privacyMap ? maskText(opts.lastRequest, privacyMap) : opts.lastRequest)
      : null,
    steps_so_far: [] as string[],
    data_files: inventory.map((d) => `${d.name}${d.detail ? ` (${d.detail})` : ""}`),
    active_skills: buildSkillHints(opts.databaseId, opts.activeSkills),
  };

  const questions: Record<string, Question> = {
    next_step: {
      type: "choice",
      instructions:
        "Which single tool should run next in this workflow? Choose the next concrete " +
        "step the request needs, in execution order. Do NOT repeat a tool already listed " +
        "in steps_so_far — each step must make forward progress. Use the listed data files " +
        "by their exact names. " +
        "Produce a COMPLETE plan that delivers the user's outcome: read the data, then " +
        "transform it (aggregate_data for totals, check_data for dataset checks), " +
        "persist combined tables via save_data(name=\"staging_…\"), and DELIVER the result " +
        "(report_table then chat_download for a report/dashboard; save_data for a saved " +
        "dataset). Do not stop after read-only steps — continue until the outcome is " +
        `delivered, and only then choose "${DONE_SENTINEL}".`,
      criteria: toolCriteria,
    },
  };

  // When data is loaded, also ask which file the next step reads, so data-read
  // tools can be wired to the right table without the user naming it verbatim.
  if (inventory.length > 0) {
    const dataCriteria: Record<string, string> = {};
    for (const d of inventory) dataCriteria[d.name] = d.detail || "(no detail)";
    dataCriteria[DATA_NONE_SENTINEL] = "This step does not read a loaded data file.";
    questions.data_file = {
      type: "choice",
      instructions:
        "Which loaded data file (if any) should the next step read? Pick the file " +
        `that matches the request; if none, choose "${DATA_NONE_SENTINEL}".`,
      criteria: dataCriteria,
    };
  }

  const key = await getClassifierKey(opts.userId);

  const steps: PlanStep[] = [];
  const log: string[] = [];
  const missingRequired: string[] = [];
  const usedTools = new Set<string>();
  // Name a prior persist step wrote, so a later data-read step can reference the
  // saved result (not the original source file or Jev's data-file guess).
  let lastPersistedName: string | null = null;

  for (let i = 0; i < maxSteps; i++) {
    const { response } = await askClassifier(state, questions, { apiKey: key });
    const answer = response.answers.next_step as ChoiceAnswer;

    const ranked = Object.entries(answer.probabilities ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, prob]) => ({ name, prob }));
    const originalTop = ranked[0];
    if (!originalTop || originalTop.name === DONE_SENTINEL) break;
    if (originalTop.prob < NEXT_TOOL_THRESHOLD) break;

    // Dedup: Jev can keep ranking the same generic tool (e.g. "get_data") top;
    // skip already-used tools so the plan makes forward progress instead of
    // repeating one step until maxSteps.
    const top =
      usedTools.has(originalTop.name)
        ? ranked.find((r) => r.name !== DONE_SENTINEL && !usedTools.has(r.name)) ?? originalTop
        : originalTop;
    if (!top || top.name === DONE_SENTINEL) break;

    const toolId = top.name;
    usedTools.add(toolId);
    const params = await getToolParams(toolId);
    const extraction = extractParams(toolId, opts.rawMessage, params);

    // Jev's data-file pick (asked alongside the next-step question).
    const dataAnswer = response.answers.data_file as ChoiceAnswer | undefined;
    let dataFile: string | null = null;
    if (dataAnswer && inventory.length > 0) {
      const topData = Object.entries(dataAnswer.probabilities ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([name, prob]) => ({ name, prob }))[0];
      if (topData && topData.name !== DATA_NONE_SENTINEL && topData.prob >= DATA_FILE_THRESHOLD) {
        dataFile = topData.name;
      }
    }

    // Fill data-file references (e.g. get_data(name=…)) from the inventory
    // when the extractor could not resolve them from the request text alone.
    const values: Record<string, unknown> = { ...extraction.values };
    let resolvedDataName: string | null = null;
    for (const p of params) {
      if (values[p.name] !== undefined) continue;
      if (!DATA_READ_TOOLS.has(toolId) || !DATA_NAME_KEYS.has(p.name)) continue;
      const resolved = resolveDataName(opts.rawMessage, inventory) ?? lastPersistedName ?? dataFile;
      if (resolved) {
        values[p.name] = resolved;
        resolvedDataName = resolved;
      }
    }

    // Cross-step wiring: a required input that consumes a prior step's output is
    // wired to {{result}} (the run_MCP bridge's output parameter). Only once a
    // prior step exists, and only for params that are conventionally outputs.
    if (steps.length > 0) {
      for (const p of params) {
        if (values[p.name] !== undefined) continue;
        if (p.required && OUTPUT_REF_KEYS.has(p.name)) {
          values[p.name] = "{{result}}";
        }
      }
    }

    // Persist tools need a durable name to write under. Auto-generate a concrete
    // literal name so the plan validates (staging_* stays unprefixed, matching
    // the workflow's setData convention).
    if (toolId === "save_data" || toolId === "set_param") {
      for (const p of params) {
        if (values[p.name] !== undefined) continue;
        if (p.required && p.name === "name") {
          values[p.name] = toolId === "save_data" ? "staging_result" : "result";
          if (toolId === "save_data") lastPersistedName = values[p.name] as string;
        }
      }
      // Persist the prior step's output under its declared type (a flattened
      // json_array for tabular producers, json_object otherwise) so the saved
      // result is structured data, not a text blob. Always override — the
      // tool's `type` param defaults to "string", which extractParams already
      // applied, so a mere "undefined" check would never replace it.
      if (steps.length > 0) {
        values.type = saveTypeFor(steps[steps.length - 1].tool_id);
      }
    }

    // Structured args (array/object params): synthesize deterministically for
    // known shapes (e.g. aggregate_data measures/group_by), then fall back to a
    // single LLM JSON fill for anything still missing and required.
    const columns = resolvedDataName
      ? getDataColumns(opts.databaseId, resolvedDataName)
      : [];
    const synthesized = synthesizeStructuredArgs(toolId, opts.rawMessage, columns);
    for (const [k, v] of Object.entries(synthesized)) {
      if (values[k] === undefined) values[k] = v;
    }

    const stillMissingStructured = params.filter(
      (p) =>
        p.required &&
        values[p.name] === undefined &&
        (p.type === "array" || p.type === "object" || p.type === "string"),
    );
    if (stillMissingStructured.length > 0) {
      const schema = await getToolSchema(toolId);
      if (schema) {
        try {
          const filled = await llmFillStructuredArgs({
            databaseId: opts.databaseId,
            userId: opts.userId,
            toolId,
            rawMessage: opts.rawMessage,
            columns,
            schema,
            missing: stillMissingStructured.map((p) => ({
              name: p.name,
              description: p.description,
              type: p.type,
            })),
          });
          for (const [k, v] of Object.entries(filled)) {
            if (values[k] === undefined) values[k] = v;
          }
        } catch (err: any) {
          console.warn(`[compose] LLM arg fill failed for ${toolId}: ${err.message}`);
        }
      }
    }

    const stepMissing = params
      .filter((p) => p.required && values[p.name] === undefined)
      .map((p) => p.name);

    steps.push({
      tool_id: toolId,
      tool_parameters: values,
      label: stepLabel(toolId),
    });
    for (const p of stepMissing) {
      missingRequired.push(`${toolId}.${p}`);
    }
    log.push(`step ${i + 1}: ${toolId} (${top.prob.toFixed(2)})`);
    (state.steps_so_far as string[]).push(toolId);
  }

  // ── Report-tail synthesis (safety net) ─────────────────────────────────
  // If Jev composed a plan that computes a table (aggregate_data) but never
  // delivers anything (no report/download/persist), deterministically append the
  // standard report tail so the plan produces a visible, auditable artifact.
  // Mirrors the deterministic build's "synthesize a report tail" so a chat plan
  // that stops at "aggregate" isn't rejected by the `satisfies` gate.
  const DELIVERY_TOOLS = new Set([
    "report_table", "report_qbo_pnl", "report_qbo_bs", "report_plan_variance", "chat_download",
  ]);
  const hasDelivery = steps.some((s) => DELIVERY_TOOLS.has(s.tool_id));
  const hasPersisted = steps.some((s) => s.tool_id === "save_data");
  if (!hasDelivery && !hasPersisted) {
    const aggregate = [...steps].reverse().find((s) => {
      if (s.tool_id !== "aggregate_data") return false;
      const gb = s.tool_parameters?.group_by;
      return Array.isArray(gb) && gb.length > 0;
    });
    if (aggregate?.tool_parameters) {
      const source = String(aggregate.tool_parameters.name ?? "");
      const groupBy = (aggregate.tool_parameters.group_by as string[]).filter(
        (x) => typeof x === "string",
      );
      const staging = `staging_${source}_summary`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const title = `${source} by ${groupBy.join(", ")}`;

      const idx = steps.findIndex((s) => s.tool_id === "aggregate_data");
      if (idx !== -1) {
        steps.splice(idx + 1, 0, {
          tool_id: "save_data",
          tool_parameters: { name: staging, value: "{{result}}", type: saveTypeFor("aggregate_data") },
          label: "Save summary",
        });
      }
      steps.push(
        {
          tool_id: "report_table",
          tool_parameters: { summary: staging, details: source, group_by: groupBy, title },
          label: "Build report",
        },
        {
          tool_id: "chat_download",
          tool_parameters: { data: "{{result}}", filename: "report.html" },
          label: "Download report",
        },
      );
      log.push(`synthesized report tail: ${staging} → report_table → chat_download`);
    }
  }

  const plan: NodePlan = { steps };
  console.log(
    `[compose] ${steps.length} step(s): ` +
      (steps
        .map((s) =>
          s.tool_parameters?.type
            ? `${s.tool_id}[${s.tool_parameters.type}]`
            : s.tool_id,
        )
        .join(" → ") || "(none)") +
      (missingRequired.length ? ` | missing: ${missingRequired.join(", ")}` : ""),
  );
  return { plan, log, missingRequired };
}
