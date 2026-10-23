// Deterministic workflow reconstruction from a chat session's durable tool-call
// record ("option B"). No LLM: the `[durable]` calls become workflow nodes, and
// run-time-variable values (dates, version names) are collected into the
// workflow_start node as parameters with the session's values as defaults.
//
// Returns null when the session can't be reconstructed deterministically (an
// unparseable non-feed durable call), so callers fall back to the LLM converter.

import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { shortId } from "@backend/utilities/shortId";

interface ToolCallRecord {
  at?: string;
  tools?: { tool: string; args?: string; wf_indicator?: boolean }[];
}

const FEED_LOAD_ENTRY = "staging_qbo_actuals";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tools whose output is a table consumed by the next step via {{result}}. */
const TABLE_PRODUCERS = new Set(["aggregate_data", "judge_data", "get_data"]);
/** Tools that produce a finished HTML report (consumed by a following
 *  chat_download via {{result}}). */
const REPORT_PRODUCERS = new Set(["report_table", "report_qbo_pnl", "report_qbo_bs", "report_plan_variance", "report_plan_cash_forecast"]);
const PARAM_KEYS = new Set([
  "start_date", "end_date", "base", "compare", "version",
  "month_from", "month_to", "reference_month", "account",
]);

export interface DeterministicWorkflow {
  workflowId: string;
  params: Record<string, string>;
}

/** A value is a run-time parameter when its key is a known parameter key or its
 *  value is a date. Strings only — numbers (fy, cutover_per) stay literal so the
 *  run_MCP bridge's string interpolation doesn't corrupt their types. */
function isParamKey(k: string, v: unknown): boolean {
  if (typeof v !== "string") return false;
  if (PARAM_KEYS.has(k)) return true;
  if (DATE_RE.test(v)) return true;
  return false;
}

export function buildFromToolCalls(
  databaseId: string,
  toolCalls: ToolCallRecord[] | undefined,
  workflowName = "Workflow",
): DeterministicWorkflow | null {
  if (!Array.isArray(toolCalls)) return null;

  // Flatten durable tool calls in order.
  const calls: { tool: string; args: Record<string, unknown> | null }[] = [];
  for (const turn of toolCalls) {
    for (const tc of turn.tools ?? []) {
      if (tc.wf_indicator !== true) continue;
      let args: Record<string, unknown> | null = null;
      if (tc.args) {
        try {
          args = JSON.parse(tc.args);
        } catch {
          args = null; // may still be reconstructable via the feed→load rewrite
        }
      }
      calls.push({ tool: tc.tool, args });
    }
  }
  if (calls.length === 0) return null;

  // Infer parameters (strings only) from the calls that parse cleanly.
  const params: Record<string, string> = {};
  const collectParam = (k: string, v: unknown) => {
    if (isParamKey(k, v) && params[k] === undefined) params[k] = v as string;
  };
  for (const c of calls) {
    if (!c.args) continue;
    for (const [k, v] of Object.entries(c.args)) collectParam(k, v);
  }

  // Build nodes.
  const nodes: { label: string; tool_id: string; tool_parameters: Record<string, unknown> }[] = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const prev = calls[i - 1];
    const next = calls[i + 1];

    if (c.tool === "qbo_actuals_flat" || c.tool === "qbodemo_actuals_flat") {
      const feedsLoad = next?.tool === "plan_actuals_load";
      const tp: Record<string, unknown> = {};
      if (c.args?.start_date !== undefined) tp.start_date = "{{start_date}}";
      if (c.args?.end_date !== undefined) tp.end_date = "{{end_date}}";
      if (feedsLoad) tp.store_to = FEED_LOAD_ENTRY;
      nodes.push({ label: "Fetch QBO actuals", tool_id: c.tool, tool_parameters: tp });
      continue;
    }

    if (
      c.tool === "plan_actuals_load" &&
      (prev?.tool === "qbo_actuals_flat" || prev?.tool === "qbodemo_actuals_flat")
    ) {
      // Feed hand-off: drop the (large, truncated) inline items, read by name.
      nodes.push({
        label: "Load actuals into plan",
        tool_id: "plan_actuals_load",
        tool_parameters: { source: FEED_LOAD_ENTRY },
      });
      continue;
    }

    if (!c.args) return null; // unparseable and not a feed hand-off → fall back
    const tp: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.args)) {
      tp[k] = isParamKey(k, v) ? `{{${k}}}` : v;
    }

    // Recompute-don't-freeze: when a step consumes the previous producer's
    // output, wire it to {{result}} instead of replaying the chat's frozen
    // literal (so the workflow reflects current data, not the chat snapshot).
    if (c.tool === "save_data" && prev && TABLE_PRODUCERS.has(prev.tool)) {
      tp.value = "{{result}}";
    }
    if (c.tool === "chat_download" && prev && REPORT_PRODUCERS.has(prev.tool)) {
      tp.data = "{{result}}";
    }

    nodes.push({ label: c.tool, tool_id: c.tool, tool_parameters: tp });
  }

  // Synthesize a report tail when the durable record ends in a table producer
  // but never delivered anything. Chat "analyze" sessions often compute
  // aggregate_data/judge_data/check_data and then answer in prose (which can't be
  // replayed); without this the saved workflow would produce no visible output.
  const DELIVERY_TOOLS = new Set([...REPORT_PRODUCERS, "chat_download"]);
  const hasDelivery = calls.some((c) => DELIVERY_TOOLS.has(c.tool));
  const hasPersisted = calls.some((c) => c.tool === "save_data");
  if (!hasDelivery && !hasPersisted) {
    const aggregate = [...calls].reverse().find((c) => {
      if (c.tool !== "aggregate_data") return false;
      const gb = c.args?.group_by;
      return Array.isArray(gb) && gb.length > 0;
    });
    if (aggregate?.args) {
      const source = String(aggregate.args.name ?? "");
      const groupBy = (aggregate.args.group_by as string[]).filter(
        (x) => typeof x === "string",
      );
      const staging = `staging_${source}_summary`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const title = `${source} by ${groupBy.join(", ")}`;

      // Insert save_data immediately after the aggregate node so {{result}}
      // refers to the aggregate output.
      const idx = nodes.findIndex((n) => n.tool_id === "aggregate_data");
      if (idx !== -1) {
        nodes.splice(idx + 1, 0, {
          label: "Save summary",
          tool_id: "save_data",
          tool_parameters: { name: staging, value: "{{result}}", type: "json_array" },
        });
      }
      nodes.push(
        {
          label: "Build report",
          tool_id: "report_table",
          tool_parameters: { summary: staging, details: source, group_by: groupBy, title },
        },
        {
          label: "Download report",
          tool_id: "chat_download",
          tool_parameters: { data: "{{result}}", filename: "report.html" },
        },
      );
    } else if (calls.some((c) => c.tool === "judge_data" || c.tool === "check_data")) {
      // No aggregate — render the judged/checked results as a flat data-table report.
      nodes.push({
        label: "Download report",
        tool_id: "chat_download",
        tool_parameters: { widget: "data-table", data: "{{result}}", filename: "report.html" },
      });
    }
  }

  // Create the workflow: the start node carries the inferred parameter defaults.
  const ws = requireSessionByDatabaseId(databaseId);
  const used = new Set(ws.getWorkflows().map((w) => w.name));
  let name = workflowName;
  if (used.has(name)) {
    let s = 2;
    while (used.has(`${name} (${s})`)) s++;
    name = `${name} (${s})`;
  }

  const now = new Date().toISOString();
  const wfNodes: any[] = [
    {
      id: "node-" + shortId(),
      type: "start",
      label: "Start",
      step_order: 1,
      tool_id: "workflow_start",
      tool_config: {},
      tool_parameters: params,
    },
  ];
  let order = 2;
  for (const n of nodes) {
    wfNodes.push({
      id: "node-" + shortId(),
      type: "tool",
      label: n.label,
      tool_id: n.tool_id,
      tool_parameters: n.tool_parameters,
      step_order: order++,
    });
  }
  // Terminal fail-closed audit — mirrors `ensureTerminalAudit` in the LLM build
  // path, so every workflow (deterministic or planned) ends with a Jev rule
  // check over the run stream before `workflow_end`.
  wfNodes.push({
    id: "node-" + shortId(),
    type: "tool",
    label: "Audit Workflow",
    tool_id: "workflow_audit",
    tool_parameters: {},
    step_order: order++,
  });
  wfNodes.push({
    id: "node-" + shortId(),
    type: "end",
    label: "End",
    tool_id: "workflow_end",
    tool_parameters: {},
    step_order: order,
  });

  const wfId = "wf-" + shortId();
  ws.upsertWorkflow({
    id: wfId,
    name,
    description: "Built deterministically from a chat session.",
    type: "automation",
    nodes: wfNodes,
    created_at: now,
    updated_at: now,
  } as any);

  return { workflowId: wfId, params };
}
