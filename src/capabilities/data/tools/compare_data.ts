import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, buildMasker } from "../scope";
import { reconcileTables } from "@data/reconcile";

export default defineTool({
  name: "compare_data",
  description:
    "Reconciles two tabular data files: joins them on shared key columns and compares shared columns, reporting matched rows, mismatched rows (with the numeric difference, right minus left), and rows present on only one side. Deterministic — no LLM. Use after aggregate_data on each side so both tables share the same key columns.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    left: z.string().describe("Data name for the left side."),
    right: z.string().describe("Data name for the right side."),
    on: z.array(z.string()).min(1).describe("Join key columns present in both tables."),
    compare: z.array(z.string()).min(1).describe("Columns present in both tables to compare."),
    tolerance: z.number().min(0).optional().describe("Numeric tolerance for declaring a match (default 0)."),
  },
  handler: async ({ left, right, on, compare, tolerance }) => {
    const ws = requireWs();
    const leftEntry = ws.getDataEntry(left);
    if (!leftEntry) {
      return { content: [{ type: "text" as const, text: `Data "${left}" not found.` }], isError: true };
    }
    const rightEntry = ws.getDataEntry(right);
    if (!rightEntry) {
      return { content: [{ type: "text" as const, text: `Data "${right}" not found.` }], isError: true };
    }

    const leftRows = toRows(leftEntry);
    if (leftRows === null) {
      return { content: [{ type: "text" as const, text: `"${left}" is not tabular.` }], isError: true };
    }
    const rightRows = toRows(rightEntry);
    if (rightRows === null) {
      return { content: [{ type: "text" as const, text: `"${right}" is not tabular.` }], isError: true };
    }

    const leftCols = new Set(leftEntry.columns ?? (leftRows.length ? Object.keys(leftRows[0]) : []));
    const rightCols = new Set(rightEntry.columns ?? (rightRows.length ? Object.keys(rightRows[0]) : []));
    for (const c of [...on, ...compare]) {
      if (!leftCols.has(c)) {
        return { content: [{ type: "text" as const, text: `Column "${c}" not found in "${left}".` }], isError: true };
      }
      if (!rightCols.has(c)) {
        return { content: [{ type: "text" as const, text: `Column "${c}" not found in "${right}".` }], isError: true };
      }
    }

    const result = reconcileTables(leftRows, rightRows, on, compare, tolerance ?? 0);

    // Privacy-mask string values before returning (mirrors get_data/aggregate_data).
    const masker = buildMasker();
    const maskVal = (v: unknown): unknown =>
      typeof v === "string" ? masker.mask(v) : v;
    const maskRow = (row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = maskVal(v);
      return out;
    };

    const masked = {
      left,
      right,
      on,
      compare,
      tolerance: tolerance ?? 0,
      summary: result.summary,
      mismatches: result.mismatches.map((m) => ({
        key: maskRow(m.key),
        values: m.values.map((v) => ({ column: v.column, left: maskVal(v.left), right: maskVal(v.right), difference: v.difference })),
      })),
      missing_left: result.missing_left.map(maskRow),
      missing_right: result.missing_right.map(maskRow),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
  },
});
