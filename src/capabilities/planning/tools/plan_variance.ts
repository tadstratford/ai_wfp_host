import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, DIM_ENTRY, FACTS_ENTRY, text } from "../scope";
import { variance } from "@workspace/planning/engine";
import type { AccountDim, FactRow } from "wfp-format";

export default defineTool({
  name: "plan_variance",
  description: "Computes budget-vs-actual variance at the reporting-account level. Flow accounts are summed over the period range; balance accounts (cash) use the through period. Defaults through to the last period with actuals so YTD compares apples-to-apples.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  durable: true,
  inputSchema: {
    fy: z.number().int().describe("Fiscal year."),
    base: z.string().describe("Base version, usually 'actuals'."),
    compare: z.string().describe("Compare version, e.g. 'budget1' or 'Forecast'."),
    from_per: z.number().int().min(1).max(12).optional().describe("First period (default 1)."),
    through_per: z.number().int().min(1).max(12).optional().describe("Last period (default: last with data in base)."),
  },
  handler: async ({ fy, base, compare, from_per, through_per }) => {
    const ws = requireWs();
    const dim = readEntry<AccountDim>(ws, DIM_ENTRY);
    const facts = readEntry<FactRow>(ws, FACTS_ENTRY);
    const rows = variance(facts, dim, {
      fy,
      base,
      compare,
      ...(from_per ? { fromPer: from_per } : {}),
      ...(through_per ? { throughPer: through_per } : {}),
    });
    return text({ fy, base, compare, rows });
  },
});
