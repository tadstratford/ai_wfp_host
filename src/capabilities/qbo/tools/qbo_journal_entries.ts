import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOJournalEntry } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_journal_entries",
  description: "Fetches journal entries from QuickBooks Online with full line detail. Each entry includes date, line-by-line amounts, posting types, account references (with resolved name and type), class references, and vendor/customer entity references. Use this to get the raw data needed for rule checking, audit verification, and journal review.",
  class: "read",
  inputSchema: {
    max_results: z.number().optional().describe("Max entries to fetch (default 200, max 1000)"),
    date_from: z.string().optional().describe("Earliest TxnDate (YYYY-MM-DD). Defaults to 12 months back."),
    date_to: z.string().optional().describe("Latest TxnDate (YYYY-MM-DD). Defaults to today."),
  },
  handler: async ({ max_results, date_from, date_to }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const [accounts, entries] = await Promise.all([
      client.accounts(),
      client.journalEntries(max_results ?? 200),
    ]);

    const acctMap = new Map<string, { name: string; accountType: string; accountSubType: string }>();
    for (const a of accounts) {
      acctMap.set(a.Id, {
        name: a.Name,
        accountType: a.AccountType,
        accountSubType: a.AccountSubType,
      });
    }

    const from = date_from ? new Date(date_from) : null;
    const to = date_to ? new Date(date_to) : null;

    const filtered = entries.filter((e: QBOJournalEntry) => {
      if (from && e.TxnDate && new Date(e.TxnDate) < from) return false;
      if (to && e.TxnDate && new Date(e.TxnDate) > to) return false;
      return true;
    });

    const formatted = filtered.map((e: QBOJournalEntry) => {
      const raw: any = e as any;
      const lines = (e.Line ?? []).map((line, idx) => {
        const acctRef = line.JournalEntryLineDetail?.AccountRef;
        const acct = acctRef?.value ? acctMap.get(acctRef.value) : undefined;
        const entity: any = (line as any).JournalEntryLineDetail?.Entity;
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
          entity: entity
            ? { type: entity.Type, name: entity.EntityRef?.name, id: entity.EntityRef?.value }
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
        docNumber: raw.DocNumber ?? "",
        privateNote: raw.PrivateNote ?? "",
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
