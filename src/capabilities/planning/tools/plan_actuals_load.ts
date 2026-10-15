import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, writeEntry, parseJsonArray, DIM_ENTRY, FACTS_ENTRY, text, err } from "../scope";
import { qboToActualRows, mergeRows, type QboMonthAmount } from "@workspace/planning/engine";
import type { AccountDim, FactRow } from "wfp-format";

export default defineTool({
  name: "plan_actuals_load",
  description: "Loads QBO actuals into the planning facts. Provide either `items` (a JSON array of { qboName, qboId?, period: 'YYYY-MM', amount }) or `source` (a workspace data entry name holding that array, e.g. from qbo_actuals_flat store_to). Amounts are rolled up through the dimension (id first, then name) into 'actuals' rows; anything unmapped is returned so totals still tie to QBO.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    items: z.string().optional().describe("JSON array of { qboName, qboId?, period, amount } items."),
    source: z.string().optional().describe("Workspace data entry name holding the flat items (alternative to inline items)."),
    fy_start_month: z.number().int().min(1).max(12).optional().describe("Fiscal year start month (1 = calendar year)."),
  },
  handler: async ({ items, source, fy_start_month }) => {
    const ws = requireWs();
    let arr: unknown[];
    if (source) {
      const entry = ws.getDataEntry(source);
      if (!entry || !Array.isArray(entry.content_json)) {
        return err(`Data "${source}" not found or not a flat array.`);
      }
      arr = entry.content_json;
    } else if (items) {
      try {
        arr = parseJsonArray(items, "items");
      } catch (e) {
        return err((e as Error).message);
      }
    } else {
      return err("plan_actuals_load requires either `items` or `source`.");
    }
    const dim = readEntry<AccountDim>(ws, DIM_ENTRY);
    const qboItems: QboMonthAmount[] = arr.map((it: any, i: number) => {
      if (!it || typeof it !== "object") throw new Error(`items[${i}] must be an object.`);
      return {
        qboName: String(it.qboName ?? ""),
        ...(it.qboId ? { qboId: String(it.qboId) } : {}),
        period: String(it.period ?? ""),
        amount: Number(it.amount) || 0,
      };
    });
    const { rows, unmapped } = qboToActualRows(qboItems, dim, fy_start_month ?? 1);
    const existing = readEntry<FactRow>(ws, FACTS_ENTRY);
    const merged = mergeRows(existing, rows);
    writeEntry(ws, FACTS_ENTRY, merged, ["fiscal year", "version", "account"]);
    return text({ loaded: rows.length, unmapped, total_rows: merged.length });
  },
});
