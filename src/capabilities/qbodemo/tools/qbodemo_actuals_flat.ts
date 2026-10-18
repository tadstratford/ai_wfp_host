import { z } from "zod";
import { defineTool } from "../../tool";
import { getDatabaseId, requireWs, writeDataEntry, monthRange } from "../scope";
import { demoQbo } from "../store";

export default defineTool({
  name: "qbodemo_actuals_flat",
  description: "Pulls DEMO QuickBooks Profit & Loss actuals as a flat monthly feed for the planning database: one { qboName, qboId, period: 'YYYY-MM', amount } item per account per month, in natural sign. Use this to feed plan_actuals_load. When store_to is set, also writes the items to that workspace data entry so a workflow node can hand them to plan_actuals_load by name.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  durable: true,
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to 'Accrual'. Ignored by the demo store."),
    store_to: z.string().optional().describe("Optional workspace data entry name to also write the flat items to (json_array)."),
  },
  handler: async ({ start_date, end_date, store_to }) => {
    const months = monthRange(start_date, end_date);
    const items = demoQbo.actualsInRange(start_date, end_date);

    const db = getDatabaseId();
    if (store_to && db) {
      const ws = requireWs();
      writeDataEntry(ws, store_to, items, ["qboName", "qboId", "period", "amount"]);
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ company: demoQbo.companyName(), count: items.length, periods: months.map((m) => m.period), ...(store_to ? { stored_to: store_to } : {}), items }),
      }],
    };
  },
});
