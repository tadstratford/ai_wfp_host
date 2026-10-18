import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, writeEntry, FACTS_ENTRY, text, err } from "../scope";
import { mergeRows } from "@workspace/planning/engine";
import { perKey, type FactRow } from "wfp-format";

/** Calendar month columns → per_1..per_12 (calendar-year fiscal mapping). */
const MONTH_COLUMNS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default defineTool({
  name: "plan_budget_load",
  description: "Loads a tabular budget (rows = reporting lines, columns = Account + Jan..Dec) into the planning facts as a named version. Reads the source data entry, maps each row's Account column to 'account' and its Jan..Dec columns to per_1..per_12, and writes { \"fiscal year\", version, account, per_1..per_12 } rows. Use this to load an uploaded Excel/CSV budget as budget1 (or any version).",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    source: z.string().describe("Data entry name holding the budget table (e.g. 'budget_budget')."),
    version: z.string().describe("Version name to write, e.g. 'budget1'."),
    fiscal_year: z.number().int().describe("Fiscal year, e.g. 2026."),
    account_column: z.string().optional().describe("Column holding the reporting line name (default 'Account')."),
  },
  handler: async ({ source, version, fiscal_year, account_column }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(source);
    if (!entry || !Array.isArray(entry.content_json)) {
      return err(`Data "${source}" not found or not a table.`);
    }

    const accountCol = account_column ?? "Account";
    const rows: FactRow[] = [];
    for (const raw of entry.content_json as Record<string, unknown>[]) {
      const account = String((raw as any)[accountCol] ?? "").trim();
      if (!account) continue;
      const fact: Record<string, unknown> = {
        "fiscal year": fiscal_year,
        version,
        account,
      };
      for (let i = 0; i < MONTH_COLUMNS.length; i++) {
        fact[perKey(i + 1)] = toNum((raw as any)[MONTH_COLUMNS[i]]);
      }
      rows.push(fact as unknown as FactRow);
    }

    if (rows.length === 0) {
      return err(`No rows loaded from "${source}" (missing "${accountCol}" column?).`);
    }

    const existing = readEntry<FactRow>(ws, FACTS_ENTRY);
    const merged = mergeRows(existing, rows);
    writeEntry(ws, FACTS_ENTRY, merged, ["fiscal year", "version", "account"]);
    return text({
      source,
      version,
      fiscal_year,
      rows_written: rows.length,
      total_rows_in_store: merged.length,
    });
  },
});
