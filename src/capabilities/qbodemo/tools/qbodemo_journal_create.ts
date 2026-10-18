import { z } from "zod";
import { defineTool } from "../../tool";
import { demoQbo, type DemoJournalEntryInput } from "../store";
import { requireWs } from "../scope";

export default defineTool({
  name: "qbodemo_journal_create",
  description: "Creates (posts) a new journal entry in the DEMO QuickBooks company. The entry must be balanced (total debits equal total credits). Accounts and classes may be referenced by Id or exact name (case-insensitive). The demo store keeps posted entries in memory so qbodemo_journal_entries can read them back.",
  class: "destructive-write",
  inputSchema: {
    txn_date: z.string().describe("Transaction date (YYYY-MM-DD)"),
    lines: z.array(z.object({
      account: z.string().describe("Account Id or exact account name (name lookup is case-insensitive)"),
      posting_type: z.enum(["Debit", "Credit"]).describe("Posting type for this line"),
      amount: z.number().positive().describe("Positive amount; sign is derived from posting_type"),
      description: z.string().optional().describe("Optional line description"),
      class: z.string().optional().describe("QBO Class name or Id (for class tracking)"),
    })).optional().describe("Journal entry lines; total debits must equal total credits"),
    lines_source: z.string().optional().describe("Data entry name holding the journal lines (e.g. the interim table written by qbodemo_allocation_compute) as an alternative to inline `lines`."),
    private_note: z.string().optional().describe("Optional private note"),
    doc_number: z.string().optional().describe("Optional reference/doc number"),
  },
  handler: async ({ txn_date, lines, lines_source, private_note, doc_number }) => {
    const accounts = demoQbo.accounts();
    const classes = demoQbo.classes();

    const acctById = new Map(accounts.map((a) => [a.Id, a]));
    const acctByName = new Map(accounts.map((a) => [a.Name.trim().toLowerCase(), a.Id]));
    const classById = new Map(classes.map((c) => [c.Id, c]));
    const classByName = new Map(classes.map((c) => [c.Name.trim().toLowerCase(), c.Id]));

    const resolveRef = (
      ref: string,
      byId: Map<string, unknown>,
      byName: Map<string, string>,
      label: string,
      options: string[],
    ): string => {
      const trimmed = ref.trim();
      if (/^\d+$/.test(trimmed) && byId.has(trimmed)) return trimmed;
      const id = byName.get(trimmed.toLowerCase());
      if (!id) {
        throw new Error(`${label} not found: "${ref}". Available: ${options.length ? options.join(", ") : "none"}`);
      }
      return id;
    };

    let lineInputs: any[];
    if (lines_source) {
      const ws = requireWs();
      const entry = ws.getDataEntry(lines_source);
      if (!entry || !Array.isArray(entry.content_json)) {
        return { content: [{ type: "text" as const, text: `Lines source "${lines_source}" not found or not a table.` }], isError: true };
      }
      lineInputs = entry.content_json as any[];
    } else {
      lineInputs = lines ?? [];
    }
    if (lineInputs.length < 2) {
      return { content: [{ type: "text" as const, text: "Journal entry requires at least 2 lines (provide `lines` or `lines_source`)." }], isError: true };
    }

    const qboLines = lineInputs.map((l) => ({
      Description: l.description ?? "",
      Amount: l.amount,
      DetailType: "JournalEntryLineDetail" as const,
      JournalEntryLineDetail: {
        PostingType: l.posting_type,
        AccountRef: { value: resolveRef(l.account, acctById, acctByName, "Account", accounts.map((a) => a.Name)), name: l.account.trim() },
        ...(l.class ? { ClassRef: { value: resolveRef(l.class, classById, classByName, "Class", classes.map((c) => c.Name)), name: l.class.trim() } } : {}),
      },
    }));

    const totalDebit = qboLines
      .filter((l) => l.JournalEntryLineDetail.PostingType === "Debit")
      .reduce((s, l) => s + l.Amount, 0);
    const totalCredit = qboLines
      .filter((l) => l.JournalEntryLineDetail.PostingType === "Credit")
      .reduce((s, l) => s + l.Amount, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            created: false,
            error: `Journal entry is not balanced: debits $${totalDebit.toFixed(2)} vs credits $${totalCredit.toFixed(2)}.`,
          }),
        }],
      };
    }

    const entry: DemoJournalEntryInput = {
      TxnDate: txn_date,
      ...(private_note ? { PrivateNote: private_note } : {}),
      ...(doc_number ? { DocNumber: doc_number } : {}),
      Line: qboLines,
    };

    const created = demoQbo.createJournalEntry(entry);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: true,
          id: created.Id,
          txnDate: created.TxnDate,
          totalDebit,
          totalCredit,
        }),
      }],
    };
  },
});
