import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOVendor, type QBOJournalEntry } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_duplicates",
  description: "Scans QBO vendors and journal entries for duplicates. Finds vendors with identical or near-identical names, and journal entries with same date and amount.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const [vendors, entries] = await Promise.all([
      client.vendors(),
      client.journalEntries(500),
    ]);

    const activeVendors = vendors.filter((v: QBOVendor) => v.Active);
    const dupes: any[] = [];

    const byName = new Map<string, QBOVendor[]>();
    for (const v of activeVendors) {
      const key = v.DisplayName.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(v);
    }
    for (const [name, matches] of byName) {
      if (matches.length > 1) {
        dupes.push({ type: "vendor", name: matches[0].DisplayName, count: matches.length, ids: matches.map((m) => m.Id), match_field: "DisplayName (exact)" });
      }
    }

    const byDateAmt = new Map<string, QBOJournalEntry[]>();
    for (const e of entries) {
      const total = e.Line?.reduce((s, l) => s + Math.abs(l.Amount), 0) ?? 0;
      const key = `${e.TxnDate}|${total.toFixed(2)}`;
      if (!byDateAmt.has(key)) byDateAmt.set(key, []);
      byDateAmt.get(key)!.push(e);
    }
    for (const [key, matches] of byDateAmt) {
      if (matches.length > 1) {
        const [date, amt] = key.split("|");
        dupes.push({ type: "entry", name: `Journal Entry ${date} $${amt}`, count: matches.length, ids: matches.map((m) => m.Id), match_field: "Date + Total Amount" });
      }
    }

    const summary = dupes.length === 0
      ? `Scanned ${activeVendors.length} vendors and ${entries.length} journal entries. No duplicates found.`
      : `Found ${dupes.length} duplicate groups (${dupes.filter((d) => d.type === "vendor").length} vendor, ${dupes.filter((d) => d.type === "entry").length} entry).`;

    return { content: [{ type: "text" as const, text: JSON.stringify({ duplicates: dupes, summary }) }] };
  },
});
