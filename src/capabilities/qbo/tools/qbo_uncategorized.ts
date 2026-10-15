import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOAccount } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_uncategorized",
  description: "Scans QBO for entries in uncategorized accounts, entries without a customer/vendor name, and entries in catch-all accounts.",
  class: "read",
  inputSchema: {
    max_results: z.number().optional().describe("Max entries to scan (default 200)"),
  },
  handler: async ({ max_results }) => {
    const scope = requireScope();
    const maxRes = max_results ?? 200;

    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const [accounts, purchases] = await Promise.all([
      client.accounts(),
      client.purchases(maxRes),
    ]);

    const uncategorizedAccountNames = new Set(
      accounts
        .filter((a: QBOAccount) =>
          /uncategorized|ask my accountant|suspense|clearing/i.test(a.Name) ||
          /uncategorized/i.test(a.AccountType),
        )
        .map((a: QBOAccount) => a.Name),
    );

    const items: any[] = [];

    for (const p of purchases) {
      const acctName = p.AccountRef?.name ?? "";
      if (uncategorizedAccountNames.has(acctName)) {
        items.push({
          type: "Purchase", name: p.EntityRef?.name ?? "(unnamed)",
          account: acctName, amount: p.TotalAmt, date: p.TxnDate,
          issue: `Entry in uncategorized account "${acctName}"`,
        });
      }
    }

    for (const p of purchases) {
      if (!p.EntityRef?.name && !p.EntityRef?.value) {
        if (!items.some((i) => i.issue.includes(p.TxnDate) && i.amount === p.TotalAmt)) {
          items.push({
            type: "Purchase", name: "(no name assigned)",
            account: p.AccountRef?.name ?? "Unknown", amount: p.TotalAmt, date: p.TxnDate,
            issue: "Purchase without a vendor/customer name",
          });
        }
      }
    }

    const summary = items.length === 0
      ? `Scanned ${purchases.length} purchases. No uncategorized entries found.`
      : `Found ${items.length} entries needing review.`;

    return { content: [{ type: "text" as const, text: JSON.stringify({ items, summary }) }] };
  },
});
