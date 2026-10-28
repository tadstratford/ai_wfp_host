import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toDiscoveryTable, buildMasker } from "../scope";
import { evaluateRuleSpec } from "@data/ruleApply";
import { FilterClauseSchema } from "@data/filter";

export default defineTool({
  name: "split_data",
  description:
    "Splits a numeric column's total across entities by percentages, deterministically (no LLM), to the cent with the rounding residual on the largest share. Percentages come from explicit `split` shares or a `splitTable` (entity + percent columns). For rules like 'split expenses by the commitment-split worksheet'. Returned entity names are privacy-masked.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    table: z.string().describe("Data file name holding the amounts."),
    amountColumn: z.string().describe("Numeric column to sum and split."),
    when: z.array(FilterClauseSchema).optional().describe("Optional row filter before summing."),
    split: z
      .array(z.object({ entity: z.string(), percent: z.number() }))
      .optional()
      .describe("Explicit split shares (percentages should sum to 100)."),
    splitTable: z.string().optional().describe("Table holding entity + percent columns (alternative to `split`)."),
    splitEntityColumn: z.string().optional().describe("Column in splitTable naming the entity."),
    splitPercentColumn: z.string().optional().describe("Column in splitTable holding the percent."),
  },
  handler: async ({ table: tableName, amountColumn, when, split, splitTable, splitEntityColumn, splitPercentColumn }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(tableName);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${tableName}" not found.` }], isError: true };
    }
    const table = toDiscoveryTable(tableName, entry);
    if (!table) {
      return { content: [{ type: "text" as const, text: `Data "${tableName}" is not tabular.` }], isError: true };
    }

    const tables = [table];
    if (splitTable) {
      const stEntry = ws.getDataEntry(splitTable);
      if (!stEntry) {
        return { content: [{ type: "text" as const, text: `Split table "${splitTable}" not found.` }], isError: true };
      }
      const st = toDiscoveryTable(splitTable, stEntry);
      if (!st) {
        return { content: [{ type: "text" as const, text: `Split table "${splitTable}" is not tabular.` }], isError: true };
      }
      tables.push(st);
    }

    const result = evaluateRuleSpec(
      { kind: "measure", table: tableName, amountColumn, when, split, splitTable, splitEntityColumn, splitPercentColumn },
      tables,
    );

    if (!result.applied) {
      return {
        content: [{ type: "text" as const, text: `Could not split: ${result.reason ?? ""} (${(result.needs ?? []).join(", ")})` }],
        isError: true,
      };
    }

    const masker = buildMasker();
    const allocations = (result.allocations ?? []).map((a) => ({ entity: masker.mask(a.entity), total: a.total }));

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ allocations, total: result.total }, null, 2) }],
    };
  },
});
