import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, stagedFromEntry, buildMasker } from "../scope";
import { aggregateLarge, aggregateCells, type AggregateMeasure } from "@data/stats";

export default defineTool({
  name: "aggregate_data",
  description: "Aggregates a loaded tabular data file: group by columns and compute sum/count/avg/min/max over numeric columns. Large files are streamed in one pass (no full load). Returned group keys and values are privacy-masked.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    name: z.string().describe("Data file name"),
    group_by: z.array(z.string()).optional().describe("Column names to group by. Omit for a single grand-total group."),
    measures: z.array(z.object({
      column: z.string().describe("Numeric column to aggregate."),
      fn: z.enum(["sum", "count", "avg", "min", "max"]).describe("Aggregation function."),
    })).min(1).describe("Aggregations to compute (e.g. sum of Debit grouped by Account)."),
    limit: z.number().int().min(1).max(500).optional().describe("Max groups to return. Default 50."),
  },
  handler: async ({ name, group_by, measures, limit }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }

    const gb = group_by ?? [];
    const ms: AggregateMeasure[] = measures.map((m) => ({ column: m.column, fn: m.fn }));
    const masker = buildMasker();
    const lim = limit ?? 50;

    let res: { groups: { key: Record<string, string> | null; measures: Record<string, number | null>; count: number }[]; totalGroups: number };
    if (entry.large && typeof entry.content === "string") {
      res = aggregateLarge(entry.content, stagedFromEntry(entry), gb, ms, lim);
    } else {
      const rows = toRows(entry);
      if (rows === null) {
        return { content: [{ type: "text" as const, text: `Data "${name}" is not tabular.` }], isError: true };
      }
      const colNames = entry.columns ?? (rows.length ? Object.keys(rows[0]) : []);
      const cellRows = rows.map((r) => colNames.map((c) => String((r as Record<string, unknown>)[c] ?? "")));
      res = aggregateCells(colNames, cellRows, gb, ms, lim);
    }

    const groups = res.groups.map((g) => ({
      key: g.key
        ? Object.fromEntries(Object.entries(g.key).map(([k, v]) => [k, masker.mask(v)]))
        : null,
      measures: g.measures,
      count: g.count,
    }));

    const result = {
      name,
      content_type: entry.content_type ?? "csv",
      total_groups: res.totalGroups,
      returned_groups: groups.length,
      groups,
      source_filename: entry.source_filename ?? null,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});
