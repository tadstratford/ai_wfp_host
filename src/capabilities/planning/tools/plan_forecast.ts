import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, writeEntry, parseJsonArray, FACTS_ENTRY, text, err } from "../scope";
import { forecastCash, type CashBalance, type ForecastMethod } from "../forecast";
import { mergeRows, lastPerWithData } from "@workspace/planning/engine";
import type { FactRow } from "wfp-format";

export default defineTool({
  name: "plan_forecast",
  description: "Builds a deterministic cash forecast: writes an 'actuals' row (cash balances through cutover_per), a 'Forecast' version that projects the remaining months ('hold' keeps the last balance flat; 'trend' repeats the last month-over-month change), and a 'Latest estimate' version blending the two. Balances are month-end { period: 'YYYY-MM', amount } items, natural sign. Use this for a cash forecast; feed it the month-end bank balances from the demo or live QBO balance sheet.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    fy: z.number().int().describe("Fiscal year."),
    balances: z.string().optional().describe("JSON array of { period: 'YYYY-MM', amount } month-end cash balances."),
    source: z.string().optional().describe("Workspace data entry name holding the { period, amount } balances (alternative to inline balances)."),
    account: z.string().optional().describe("Balance account name (default 'Operating Cash')."),
    cutover_per: z.number().int().min(1).max(12).optional().describe("Last period taken from actuals (default: last period with actuals data)."),
    method: z.enum(["hold", "trend"]).optional().describe("Projection method. Default 'hold'."),
  },
  handler: async ({ fy, balances, source, account, cutover_per, method }) => {
    const ws = requireWs();
    let arr: unknown[];
    if (source) {
      const entry = ws.getDataEntry(source);
      if (!entry || !Array.isArray(entry.content_json)) {
        return err(`Data "${source}" not found or not a flat array.`);
      }
      arr = entry.content_json;
    } else if (balances) {
      try {
        arr = parseJsonArray(balances, "balances");
      } catch (e) {
        return err((e as Error).message);
      }
    } else {
      return err("plan_forecast requires either `balances` or `source`.");
    }

    const items: CashBalance[] = arr.map((it: any, i: number) => {
      if (!it || typeof it !== "object") throw new Error(`balances[${i}] must be an object.`);
      return { period: String(it.period ?? ""), amount: Number(it.amount) || 0 };
    });

    const existing = readEntry<FactRow>(ws, FACTS_ENTRY);
    const cut = cutover_per ?? lastPerWithData(existing, fy, "actuals");
    if (cut < 1 || cut > 12) {
      return err(`No actuals data for fiscal year ${fy} — provide cutover_per.`);
    }

    const acct = account ?? "Operating Cash";
    const m = (method ?? "hold") as ForecastMethod;
    const fc = forecastCash(items, fy, cut, m, acct);

    const merged = mergeRows(mergeRows(existing, [fc.actuals, fc.forecast]), [fc.latest]);
    writeEntry(ws, FACTS_ENTRY, merged, ["fiscal year", "version", "account"]);

    return text({
      account: acct,
      fy,
      cutover_per: cut,
      method: m,
      forecast_months: fc.months
        .filter((x) => x.per > cut && x.forecast !== null)
        .map((x) => ({ period: x.per, projected: x.forecast })),
      latest_estimate: fc.months.map((x) => ({ period: x.per, balance: x.latest })),
      total_rows_in_store: merged.length,
    });
  },
});
