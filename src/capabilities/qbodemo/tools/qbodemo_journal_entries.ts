import { z } from "zod";
import { defineTool } from "../../tool";
import { demoQbo } from "../store";

export default defineTool({
  name: "qbodemo_journal_entries",
  description: "Fetches journal entries from the DEMO QuickBooks company with full line detail — date, line amounts, posting types, account references, and class references. Use this to verify a posted journal entry.",
  class: "read",
  inputSchema: {
    max_results: z.number().optional().describe("Max entries to fetch (default 200, max 1000)"),
    date_from: z.string().optional().describe("Earliest TxnDate (YYYY-MM-DD). Defaults to 12 months back."),
    date_to: z.string().optional().describe("Latest TxnDate (YYYY-MM-DD). Defaults to today."),
  },
  handler: async ({ max_results, date_from, date_to }) => {
    const accounts = demoQbo.accounts();
    const acctMap = new Map(accounts.map((a) => [a.Id, { name: a.Name, accountType: a.AccountType, accountSubType: a.AccountSubType }]));

    const entries = demoQbo.journalEntries();
    const from = date_from ? new Date(date_from) : null;
    const to = date_to ? new Date(date_to) : null;

    const filtered = entries.filter((e) => {
      if (from && e.TxnDate && new Date(e.TxnDate) < from) return false;
      if (to && e.TxnDate && new Date(e.TxnDate) > to) return false;
      return true;
    });

    const formatted = filtered.map((e) => {
      const lines = (e.Line ?? []).map((line, idx) => {
        const acctRef = line.JournalEntryLineDetail?.AccountRef;
        const acct = acctRef?.value ? acctMap.get(acctRef.value) : undefined;
        return {
          line: idx + 1,
          amount: line.Amount,
          description: line.Description ?? "",
          postingType: line.JournalEntryLineDetail?.PostingType,
          accountRef: acctRef ? { id: acctRef.value, name: acctRef.name } : undefined,
          accountName: acct?.name ?? acctRef?.name ?? "",
          accountType: acct?.accountType ?? "",
          accountSubType: acct?.accountSubType ?? "",
          classRef: line.JournalEntryLineDetail?.ClassRef
            ? { id: line.JournalEntryLineDetail.ClassRef.value, name: line.JournalEntryLineDetail.ClassRef.name }
            : undefined,
        };
      });

      const totalDebit = lines
        .filter((l) => l.postingType === "Debit")
        .reduce((s, l) => s + (l.amount || 0), 0);
      const totalCredit = lines
        .filter((l) => l.postingType === "Credit")
        .reduce((s, l) => s + (l.amount || 0), 0);

      return {
        id: e.Id,
        txnDate: e.TxnDate,
        docNumber: e.DocNumber ?? "",
        privateNote: e.PrivateNote ?? "",
        lineCount: lines.length,
        totalDebit,
        totalCredit,
        balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        lines,
      };
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          company: demoQbo.companyName(),
          entries: formatted,
          count: formatted.length,
          totalFetched: entries.length,
          dateRange: {
            from: from?.toISOString().split("T")[0] ?? "unbounded",
            to: to?.toISOString().split("T")[0] ?? "unbounded",
          },
        }),
      }],
    };
  },
});
