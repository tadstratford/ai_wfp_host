import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, buildMasker } from "../scope";
import { tieOut, type TieOutSheet } from "@data/tieOut";
import { cellMapToGrid } from "@data/stage";

function gridFor(entry: any): string[][] | null {
  if (!entry || typeof entry.content_json !== "object" || Array.isArray(entry.content_json)) return null;
  const cells = entry.content_json as Record<string, string>;
  if (Object.keys(cells).length === 0) return null;
  return cellMapToGrid(cells);
}

export default defineTool({
  name: "tie_out",
  description:
    "Ties the supporting schedules to the trial balance, keyed by account number. Reads the raw Trial Balance and Balance Sheet (account code → debit/credit and account code → amount + supporting-schedule note), joins on the leaf account code, and compares each supporting schedule (the Balance Sheet Notes values) to its mapped trial-balance balances. Deterministic — no LLM. Auto-discovers the raw sheets by name when not passed explicitly.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    trial_balance: z.string().optional().describe("Raw sheet name of the Trial Balance (auto-discovered when omitted)."),
    balance_sheet: z.string().optional().describe("Raw sheet name of the Balance Sheet (auto-discovered when omitted)."),
    tolerance: z.number().min(0).optional().describe("Numeric tolerance for declaring a tie (default 0)."),
  },
  handler: async ({ trial_balance, balance_sheet, tolerance }) => {
    const ws = requireWs();

    const rawSheets = ws
      .getDataNames()
      .filter((n) => {
        const e = ws.getDataEntry(n);
        return (
          e?.content_type === "json_cells" &&
          typeof e.content_json === "object" &&
          !Array.isArray(e.content_json)
        );
      });

    const tbName =
      trial_balance ??
      rawSheets.find((n) => /trial[_\s-]*balance/i.test(n));
    if (!tbName) {
      return {
        content: [{ type: "text" as const, text: "No Trial Balance raw sheet found in the loaded data." }],
        isError: true,
      };
    }
    const bsName =
      balance_sheet ??
      rawSheets.find((n) => /balance[_\s-]*sheet/i.test(n) && !/ytd|trial/i.test(n));

    const tbGrid = gridFor(ws.getDataEntry(tbName));
    if (!tbGrid) {
      return { content: [{ type: "text" as const, text: `"${tbName}" is not a raw sheet.` }], isError: true };
    }

    const tb: TieOutSheet = { name: tbName, grid: tbGrid };
    let bs: TieOutSheet | null = null;
    if (bsName) {
      const g = gridFor(ws.getDataEntry(bsName));
      if (g) bs = { name: bsName, grid: g };
    }

    const result = tieOut({ trialBalance: tb, balanceSheet: bs, tolerance: tolerance ?? 0 });

    const masker = buildMasker();
    const mask = (s: string) => masker.mask(s);

    const masked = {
      trial_balance: result.trial_balance,
      balance_sheet: result.balance_sheet,
      tolerance: result.tolerance,
      summary: result.summary,
      accounts: result.accounts.map((a) => ({
        code: a.code,
        name: mask(a.name),
        bs_amount: a.bs_amount,
        tb_balance: a.tb_balance,
        variance: a.variance,
        status: a.status,
      })),
      schedules: result.schedules.map((s) => ({
        schedule: mask(s.schedule),
        account_codes: s.account_codes,
        schedule_total: s.schedule_total,
        tb_balance: s.tb_balance,
        variance: s.variance,
        status: s.status,
        basis: s.basis,
      })),
    };

    return { content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }] };
  },
});
