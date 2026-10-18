import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, getDatabaseId } from "../scope";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { QBOClient, checkQBOConnected, type QBOAccount, type QBOVendor, type QBOCustomer, type QBOClass, type QBODepartment, type QBOJournalEntryInput } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_journal_create",
  description: "Creates (posts) a new journal entry in QuickBooks Online. The entry must be balanced (total debits equal total credits). Accounts, classes, locations, vendors, and customers may all be referenced by QBO Id or exact name (case-insensitive). Use class for class tracking and location for location tracking (QBO Department); attach a vendor to Accounts Payable lines.",
  class: "destructive-write",
  inputSchema: {
    txn_date: z.string().describe("Transaction date (YYYY-MM-DD)"),
    lines: z.array(z.object({
      account: z.string().describe("Account Id or exact account name (name lookup is case-insensitive)"),
      posting_type: z.enum(["Debit", "Credit"]).describe("Posting type for this line"),
      amount: z.number().positive().describe("Positive amount; sign is derived from posting_type"),
      description: z.string().optional().describe("Optional line description"),
      class: z.string().optional().describe("QBO Class name or Id (for class tracking)"),
      location: z.string().optional().describe("QBO Location name or Id (for location tracking)"),
      vendor: z.string().optional().describe("Vendor name or Id to attach to this line (e.g., on an Accounts Payable line)"),
      customer: z.string().optional().describe("Customer name or Id to attach to this line"),
      employee: z.string().optional().describe("Employee Id to attach to this line (Id only)"),
    })).optional().describe("Journal entry lines; total debits must equal total credits"),
    lines_source: z.string().optional().describe("Data entry name holding the journal lines (e.g. the interim table written by qbo_allocation_compute) as an alternative to inline `lines`."),
    private_note: z.string().optional().describe("Optional private note"),
    doc_number: z.string().optional().describe("Optional reference/doc number"),
  },
  handler: async ({ txn_date, lines, lines_source, private_note, doc_number }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const [accounts, classes, departments, vendors, customers] = await Promise.all([
      client.accounts(),
      client.classes().catch(() => [] as QBOClass[]),
      client.departments().catch(() => [] as QBODepartment[]),
      client.vendors().catch(() => [] as QBOVendor[]),
      client.customers().catch(() => [] as QBOCustomer[]),
    ]);

    const acctById = new Map<string, QBOAccount>();
    const acctByName = new Map<string, string>();
    for (const a of accounts) {
      acctById.set(a.Id, a);
      acctByName.set(a.Name.trim().toLowerCase(), a.Id);
    }

    const classById = new Map<string, QBOClass>();
    const classByName = new Map<string, string>();
    for (const c of classes) {
      classById.set(c.Id, c);
      classByName.set(c.Name.trim().toLowerCase(), c.Id);
    }

    const deptById = new Map<string, QBODepartment>();
    const deptByName = new Map<string, string>();
    for (const d of departments) {
      deptById.set(d.Id, d);
      deptByName.set(d.Name.trim().toLowerCase(), d.Id);
    }

    const vendorById = new Map<string, QBOVendor>();
    const vendorByName = new Map<string, string>();
    for (const v of vendors) {
      vendorById.set(v.Id, v);
      vendorByName.set(v.DisplayName.trim().toLowerCase(), v.Id);
      if (v.CompanyName) vendorByName.set(v.CompanyName.trim().toLowerCase(), v.Id);
    }

    const customerById = new Map<string, QBOCustomer>();
    const customerByName = new Map<string, string>();
    for (const c of customers) {
      customerById.set(c.Id, c);
      customerByName.set(c.DisplayName.trim().toLowerCase(), c.Id);
      if (c.CompanyName) customerByName.set(c.CompanyName.trim().toLowerCase(), c.Id);
    }

    const resolveRef = (
      ref: string,
      byId: Map<string, any>,
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

    const resolveAccount = (ref: string) =>
      resolveRef(ref, acctById, acctByName, "Account", accounts.map((a) => a.Name));
    const resolveClass = (ref: string) =>
      resolveRef(ref, classById, classByName, "Class", classes.map((c) => c.Name));
    const resolveLocation = (ref: string) =>
      resolveRef(ref, deptById, deptByName, "Location", departments.map((d) => d.Name));
    const resolveVendor = (ref: string) =>
      resolveRef(ref, vendorById, vendorByName, "Vendor", vendors.map((v) => v.DisplayName));
    const resolveCustomer = (ref: string) =>
      resolveRef(ref, customerById, customerByName, "Customer", customers.map((c) => c.DisplayName));

    let lineInputs: any[];
    if (lines_source) {
      const db = getDatabaseId();
      const ws = db ? getSessionByDatabaseId(db) : null;
      const entry = ws?.getDataEntry(lines_source);
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
        AccountRef: { value: resolveAccount(l.account), name: l.account.trim() },
        ...(l.class ? { ClassRef: { value: resolveClass(l.class), name: l.class.trim() } } : {}),
        ...(l.location ? { DepartmentRef: { value: resolveLocation(l.location), name: l.location.trim() } } : {}),
        ...(l.vendor ? { Entity: { Type: "Vendor", EntityRef: { value: resolveVendor(l.vendor), name: l.vendor.trim() } } } : {}),
        ...(l.customer ? { Entity: { Type: "Customer", EntityRef: { value: resolveCustomer(l.customer), name: l.customer.trim() } } } : {}),
        ...(l.employee ? { Entity: { Type: "Employee", EntityRef: { value: l.employee.trim(), name: l.employee.trim() } } } : {}),
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

    const entry: QBOJournalEntryInput = {
      TxnDate: txn_date,
      ...(private_note ? { PrivateNote: private_note } : {}),
      ...(doc_number ? { DocNumber: doc_number } : {}),
      Line: qboLines,
    };

    const created = await client.createJournalEntry(entry);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: true,
          id: created?.JournalEntry?.Id ?? created?.Id ?? created?.id ?? null,
          txnDate: created?.JournalEntry?.TxnDate ?? txn_date,
          totalDebit,
          totalCredit,
        }),
      }],
    };
  },
});
