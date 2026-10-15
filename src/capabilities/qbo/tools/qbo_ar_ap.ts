import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_ar_ap",
  description: "Reviews Accounts Receivable (invoices) and Accounts Payable (bills) for aging, unusual amounts, and items needing attention.",
  class: "read",
  inputSchema: {
    ar_limit: z.number().optional().describe("Max invoices to review (default 100)"),
    ap_limit: z.number().optional().describe("Max bills to review (default 100)"),
    threshold_days: z.number().optional().describe("Days past due to flag as critical (default 90)"),
  },
  handler: async ({ ar_limit, ap_limit, threshold_days }) => {
    const scope = requireScope();
    const arLim = ar_limit ?? 100;
    const apLim = ap_limit ?? 100;
    const threshDays = threshold_days ?? 90;

    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const [invoices, bills] = await Promise.all([
      client.invoices(arLim),
      client.bills(apLim),
    ]);

    const today = new Date().toISOString().split("T")[0];
    const now = new Date(today);

    function daysBetween(a: string, b: string): number {
      return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
    }
    function severityClass(days: number): string {
      if (days <= 0) return "current";
      if (days <= 30) return "watch";
      if (days <= 90) return "overdue";
      return "critical";
    }

    const flagged: any[] = [];

    for (const inv of invoices) {
      if (inv.Balance <= 0) continue;
      const overdue = daysBetween(inv.DueDate, today);
      flagged.push({
        type: "AR", name: inv.CustomerRef?.name ?? `Customer #${inv.CustomerRef?.value}`,
        amount: inv.TotalAmt, balance: inv.Balance, date: inv.TxnDate,
        dueDate: inv.DueDate, daysOverdue: overdue, severity: severityClass(overdue),
      });
    }

    for (const bill of bills) {
      if (bill.Balance <= 0) continue;
      const overdue = daysBetween(bill.DueDate, today);
      flagged.push({
        type: "AP", name: bill.VendorRef?.name ?? `Vendor #${bill.VendorRef?.value}`,
        amount: bill.TotalAmt, balance: bill.Balance, date: bill.TxnDate,
        dueDate: bill.DueDate, daysOverdue: overdue, severity: severityClass(overdue),
      });
    }

    const arItems = flagged.filter((f) => f.type === "AR");
    const apItems = flagged.filter((f) => f.type === "AP");
    const arTotal = arItems.reduce((s: number, f: any) => s + f.balance, 0);
    const apTotal = apItems.reduce((s: number, f: any) => s + f.balance, 0);
    const critical = flagged.filter((f: any) => f.severity === "critical").length;
    const overdue = flagged.filter((f: any) => f.severity === "overdue").length;

    let summary = `Found ${flagged.length} open items: ${arItems.length} AR ($${arTotal.toLocaleString()}) and ${apItems.length} AP ($${apTotal.toLocaleString()}).`;
    if (critical > 0) summary += ` ${critical} items critically overdue (>${threshDays} days).`;
    if (overdue > 0) summary += ` ${overdue} items overdue.`;

    return { content: [{ type: "text" as const, text: JSON.stringify({ flagged_items: flagged, summary }) }] };
  },
});
