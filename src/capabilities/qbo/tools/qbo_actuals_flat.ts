import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, getDatabaseId, monthRange, parsePnlSingleMonth, type PnlFlatItem } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export default defineTool({
  name: "qbo_actuals_flat",
  description: "Pulls QBO Profit & Loss actuals as a flat monthly feed for the planning database: one { qboName, qboId, group, period: 'YYYY-MM', amount } item per account per month, in natural sign. qboId is the QBO account Id (rename-proof join). Fetches one single-month P&L (Total column grouping) per month so it works even for companies that reject the Months grouping. Use this to feed plan_actuals_load. When store_to is set, also writes the items to that workspace data entry so a workflow node can hand them to plan_actuals_load by name.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  durable: true,
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to 'Accrual'."),
    store_to: z.string().optional().describe("Optional workspace data entry name to also write the flat items to (json_array)."),
  },
  handler: async ({ start_date, end_date, accounting_method, store_to }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const method = accounting_method ?? "Accrual";

    const months = monthRange(start_date, end_date);
    const items: PnlFlatItem[] = [];
    for (const m of months) {
      const report = await client.profitAndLoss(m.start, m.end, {
        summarizeColumnBy: "Total",
        accountingMethod: method,
      });
      items.push(...parsePnlSingleMonth(report, m.period));
    }

    const db = getDatabaseId();
    if (store_to && db) {
      const ws = getSessionByDatabaseId(db);
      if (ws) {
        ws.setDataEntry(store_to, {
          content: JSON.stringify(items),
          content_type: "json_array",
          content_json: items,
          columns: ["qboName", "qboId", "group", "period", "amount"],
          row_count: items.length,
          edited_at: new Date().toISOString(),
        });
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ count: items.length, periods: months.map((m) => m.period), ...(store_to ? { stored_to: store_to } : {}), items }),
      }],
    };
  },
});
