import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, FACTS_ENTRY, text } from "../scope";
import type { FactRow } from "wfp-format";

export default defineTool({
  name: "plan_facts_get",
  description: "Reads planning facts (actuals, budgets, forecast — all versions are rows). Optionally filter by version, account, or fiscal year.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  inputSchema: {
    version: z.string().optional().describe("Version to filter by (e.g. 'actuals', 'budget1', 'Forecast')."),
    account: z.string().optional().describe("Reporting account to filter by."),
    fiscal_year: z.number().int().optional().describe("Fiscal year to filter by."),
  },
  handler: async ({ version, account, fiscal_year }) => {
    const ws = requireWs();
    let rows = readEntry<FactRow>(ws, FACTS_ENTRY);
    if (version) rows = rows.filter((r) => r.version === version);
    if (account) rows = rows.filter((r) => r.account === account);
    if (fiscal_year !== undefined) rows = rows.filter((r) => r["fiscal year"] === fiscal_year);
    return text({ count: rows.length, rows });
  },
});
