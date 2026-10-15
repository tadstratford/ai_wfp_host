import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_bills_list",
  description: "Fetches Bills from QuickBooks Online with vendor, date, total amount, and balance. Use this to find a bill's actual amount and vendor (by vendor name or date) before allocating or reclassifying it with a journal entry.",
  class: "read",
  inputSchema: {
    max_results: z.number().optional().describe("Max bills to fetch (default 100)"),
  },
  handler: async ({ max_results }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const bills = await client.bills(max_results ?? 100);
    return { content: [{ type: "text" as const, text: JSON.stringify({ bills, count: bills.length }) }] };
  },
});
