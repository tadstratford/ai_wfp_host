import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOAccount } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_recurring_check",
  description: "Checks that recurring monthly/quarterly expenses (like rent, insurance, utilities) are paid consistently each period. Flags gaps where an expected payment is missing.",
  class: "read",
  inputSchema: {
    expense_patterns: z.string().optional().describe("Comma-separated keywords (e.g. 'rent,insurance')"),
    frequency: z.string().optional().describe("'monthly' or 'quarterly'"),
    lookback_months: z.number().optional().describe("Months of history (default 12)"),
  },
  handler: async ({ expense_patterns, frequency, lookback_months }) => {
    const scope = requireScope();
    const patternsRaw = (expense_patterns ?? "rent,insurance").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    const freq = frequency ?? "monthly";
    const lookback = lookback_months ?? 12;

    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const allAccounts = await client.accounts();
    const matchingAccounts = allAccounts.filter((a: QBOAccount) => {
      const nameLower = (a.Name ?? "").toLowerCase();
      return patternsRaw.some((p) => nameLower.includes(p));
    }).filter((a: QBOAccount) => a.Active !== false);

    if (matchingAccounts.length === 0) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ results: [], summary: "No matching accounts found." }) }] };
    }

    function monthKey(date: string) { return date.slice(0, 7); }
    function quarterKey(date: string) {
      const d = new Date(date);
      return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    }
    const periodFn = freq === "quarterly" ? quarterKey : monthKey;

    const cutOff = new Date();
    cutOff.setMonth(cutOff.getMonth() - lookback);

    function generatePeriods(): string[] {
      const periods: string[] = [];
      const now = new Date();
      const start = new Date(cutOff.getFullYear(), cutOff.getMonth(), 1);
      while (start <= now) {
        periods.push(periodFn(start.toISOString()));
        start.setMonth(start.getMonth() + (freq === "quarterly" ? 3 : 1));
      }
      return periods;
    }

    const allPeriods = generatePeriods();
    const periodActivity = new Map<string, Map<string, { count: number; total: number }>>();
    for (const acct of matchingAccounts) {
      periodActivity.set(acct.Id, new Map());
    }

    function record(acctRef: string, date: string, amount: number) {
      const am = periodActivity.get(acctRef);
      if (!am || !date) return;
      const pk = periodFn(date);
      if (new Date(date) < cutOff) return;
      const e = am.get(pk) || { count: 0, total: 0 };
      e.count++;
      e.total += amount;
      am.set(pk, e);
    }

    const [purchases, journalEntries, bills] = await Promise.all([
      client.purchases(lookback * 50).catch(() => [] as any[]),
      client.journalEntries(lookback * 50).catch(() => [] as any[]),
      client.bills(lookback * 50).catch(() => [] as any[]),
    ]);

    for (const p of purchases || []) {
      record(p.AccountRef?.value ?? "", p.TxnDate, p.TotalAmt ?? 0);
    }
    for (const je of journalEntries || []) {
      for (const line of je.Line || []) {
        record(line.JournalEntryLineDetail?.AccountRef?.value ?? "", je.TxnDate, line.Amount ?? 0);
      }
    }
    for (const b of bills || []) {
      record(b.APAccountRef?.value ?? "", b.TxnDate, b.TotalAmt ?? 0);
    }

    const results: any[] = [];
    let totalGaps = 0;
    let totalTxns = 0;

    for (const acct of matchingAccounts) {
      const am = periodActivity.get(acct.Id)!;
      const gaps: string[] = [];
      let activePeriods = 0;
      let entriesTotal = 0;

      for (const period of allPeriods) {
        const a = am.get(period);
        if (a) { activePeriods++; entriesTotal += a.count; }
        else { gaps.push(period); }
      }

      totalGaps += gaps.length;
      totalTxns += entriesTotal;

      results.push({
        accountName: acct.Name,
        accountType: acct.AccountType,
        totalEntries: entriesTotal,
        frequency: freq,
        periodsChecked: allPeriods.length,
        activePeriods,
        gaps,
      });
    }

    const summary = totalTxns === 0
      ? "No transactions found for matching accounts."
      : totalGaps === 0
        ? `All ${freq} payments present. No gaps.`
        : `${totalGaps} gap(s) across ${results.filter((r) => r.gaps.length > 0).length} accounts.`;

    return { content: [{ type: "text" as const, text: JSON.stringify({ results, summary }) }] };
  },
});
