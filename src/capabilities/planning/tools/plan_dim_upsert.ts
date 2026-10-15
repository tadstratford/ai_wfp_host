import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, writeEntry, parseJsonArray, DIM_ENTRY, text, err } from "../scope";
import type { AccountDim } from "wfp-format";

export default defineTool({
  name: "plan_dim_upsert",
  description: "Writes the reporting-account dimension (replaces the whole dimension). Each entry: { account, kind: 'income'|'expense'|'balance', group?, order, qboSources: [name-or-{name,id}] }. qboSources may be bare account names or { name, id } refs — the id makes the QBO join survive account renames.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    entries: z.string().describe("JSON array of dimension entries."),
  },
  handler: async ({ entries }) => {
    const ws = requireWs();
    let arr: unknown[];
    try {
      arr = parseJsonArray(entries, "entries");
    } catch (e) {
      return err((e as Error).message);
    }
    const dim: AccountDim[] = arr.map((d: any, i: number) => {
      if (!d || typeof d !== "object") throw new Error(`entries[${i}] must be an object.`);
      if (typeof d.account !== "string" || !d.account.trim()) {
        throw new Error(`entries[${i}].account is required.`);
      }
      if (!["income", "expense", "balance"].includes(d.kind)) {
        throw new Error(`entries[${i}].kind must be income, expense, or balance.`);
      }
      return {
        account: d.account.trim(),
        kind: d.kind,
        ...(d.group ? { group: String(d.group).trim() } : {}),
        order: Number(d.order ?? i + 1) || i + 1,
        qboSources: Array.isArray(d.qboSources) ? d.qboSources : [],
      };
    });
    writeEntry(ws, DIM_ENTRY, dim, ["account", "kind", "group", "order", "qboSources"]);
    return text({ saved: dim.length });
  },
});
