import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toDiscoveryTable, buildMasker, maskRow } from "../scope";
import { evaluateRuleSpec } from "@data/ruleApply";
import { FilterClauseSchema } from "@data/filter";

export default defineTool({
  name: "classify_data",
  description:
    "Buckets the rows of a loaded table into outcomes deterministically (no LLM). Each outcome has `when` clauses (ANDed); a row is assigned to the FIRST matching outcome, or `defaultOutcome` when none match. For rules like 'allocate each deal to Fund I (EBITDA ≤7), Fund II (≥8), or flag (7–8)'. Returned row values are privacy-masked.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    table: z.string().describe("Data file name to classify."),
    outcomes: z
      .array(
        z.object({
          outcome: z.string().describe("Outcome label (e.g. 'Fund I', 'flag')."),
          when: z.array(FilterClauseSchema).min(1).describe("ANDed clauses selecting rows for this outcome."),
        }),
      )
      .min(1)
      .describe("Ordered outcomes — first match wins."),
    defaultOutcome: z.string().optional().describe("Outcome for rows matching none (default '(unclassified)')."),
  },
  handler: async ({ table: tableName, outcomes, defaultOutcome }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(tableName);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${tableName}" not found.` }], isError: true };
    }
    const table = toDiscoveryTable(tableName, entry);
    if (!table) {
      return { content: [{ type: "text" as const, text: `Data "${tableName}" is not tabular.` }], isError: true };
    }

    const result = evaluateRuleSpec(
      { kind: "classify", table: tableName, outcomes, defaultOutcome },
      [table],
    );

    if (!result.applied) {
      return {
        content: [{ type: "text" as const, text: `Could not classify: ${result.reason ?? ""} (${(result.needs ?? []).join(", ")})` }],
        isError: true,
      };
    }

    const masker = buildMasker();
    const masked = (result.classifications ?? []).map((c) => ({
      outcome: c.outcome,
      count: c.count,
      rows: c.rows.map((r) => maskRow(r, masker)),
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
  },
});
