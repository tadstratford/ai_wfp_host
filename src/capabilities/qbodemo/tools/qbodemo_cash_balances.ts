import { z } from "zod";
import { defineTool } from "../../tool";
import { getDatabaseId, requireWs, writeDataEntry, monthRange } from "../scope";
import { demoQbo } from "../store";

export default defineTool({
  name: "qbodemo_cash_balances",
  description: "Pulls the DEMO QuickBooks Operating Cash (bank) month-end balances as a flat feed: one { period: 'YYYY-MM', amount } item per month, natural sign. Use this to feed plan_forecast. When store_to is set, also writes the items to that workspace data entry so a workflow node can hand them to plan_forecast by name.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  durable: true,
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    store_to: z.string().optional().describe("Optional workspace data entry name to also write the flat items to (json_array)."),
  },
  handler: async ({ start_date, end_date, store_to }) => {
    const months = monthRange(start_date, end_date);
    const wanted = new Set(months.map((m) => m.period));
    const items = demoQbo
      .cashBalances()
      .filter((c) => wanted.has(c.period))
      .map((c) => ({ period: c.period, amount: c.amount }));

    const db = getDatabaseId();
    if (store_to && db) {
      const ws = requireWs();
      writeDataEntry(ws, store_to, items, ["period", "amount"]);
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          company: demoQbo.companyName(),
          account: "Operating Cash",
          count: items.length,
          periods: items.map((i) => i.period),
          ...(store_to ? { stored_to: store_to } : {}),
          items,
        }),
      }],
    };
  },
});
