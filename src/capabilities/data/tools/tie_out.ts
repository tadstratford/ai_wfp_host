import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, buildMasker } from "../scope";
import { tieOut, type TieOutTable } from "@data/tieOut";

function asTieOutTable(name: string, entry: any): TieOutTable | null {
  const rows = toRows(entry);
  if (rows === null) return null;
  const columns: string[] = Array.isArray(entry?.columns) ? (entry.columns as string[]) : (rows.length ? Object.keys(rows[0]) : []);
  return { name, columns, columnTypes: entry?.column_types ?? null, rows };
}

export default defineTool({
  name: "tie_out",
  description:
    "Ties supporting schedules / sub-ledgers to a trial balance: for each schedule, sums its amount column and compares it to the matched trial-balance account balance(s), reporting a per-schedule tie / variance / unmatched / unresolved verdict. Deterministic — no LLM. Account matching is by the schedule's account-column values, then account codes, then name tokens. Transposed schedules (amount column named by a value) are reported unresolved rather than summed.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    trial_balance: z.string().describe("Data name of the trial balance table."),
    schedules: z.array(z.string()).min(1).describe("Data names of the supporting schedule tables to tie to the trial balance."),
    tolerance: z.number().min(0).optional().describe("Numeric tolerance for declaring a tie (default 0)."),
  },
  handler: async ({ trial_balance, schedules, tolerance }) => {
    const ws = requireWs();
    const tbEntry = ws.getDataEntry(trial_balance);
    if (!tbEntry) {
      return { content: [{ type: "text" as const, text: `Data "${trial_balance}" not found.` }], isError: true };
    }
    const tb = asTieOutTable(trial_balance, tbEntry);
    if (!tb) {
      return { content: [{ type: "text" as const, text: `"${trial_balance}" is not tabular.` }], isError: true };
    }

    const scheduleTables: TieOutTable[] = [];
    for (const name of schedules) {
      const e = ws.getDataEntry(name);
      if (!e) {
        return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
      }
      const t = asTieOutTable(name, e);
      if (!t) {
        return { content: [{ type: "text" as const, text: `"${name}" is not tabular.` }], isError: true };
      }
      scheduleTables.push(t);
    }

    const result = tieOut(tb, scheduleTables, tolerance ?? 0);

    const masker = buildMasker();
    const mask = (s: string) => masker.mask(s);

    const masked = {
      trial_balance: result.trial_balance,
      account_column: result.account_column,
      tolerance: tolerance ?? 0,
      summary: result.summary,
      schedules: result.schedules.map((s) => ({
        schedule: s.schedule,
        status: s.status,
        schedule_total: s.schedule_total,
        tb_accounts: s.tb_accounts.map(mask),
        tb_balance: s.tb_balance,
        variance: s.variance,
        basis: s.basis,
      })),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
  },
});
