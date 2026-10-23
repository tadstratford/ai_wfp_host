import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, FACTS_ENTRY } from "../scope";
import { buildCashForecastReportHtml } from "../cashReport";
import { perKey, type FactRow } from "wfp-format";

export default defineTool({
  name: "report_plan_cash_forecast",
  description: "Renders the cash forecast as a self-contained, brand-styled HTML report: a month-by-month Actual vs Forecast vs 'Latest estimate' table for the cash balance account, with a projected year-end summary. Deterministic — no LLM. Returns HTML text for a following chat_download(data=\"{{result}}\") step.",
  class: "read",
  output: { metaType: "text", tabular: false },
  durable: true,
  report: true,
  inputSchema: {
    fy: z.number().int().describe("Fiscal year."),
    account: z.string().optional().describe("Balance account name (default 'Operating Cash')."),
    cutover_per: z.number().int().min(1).max(12).optional().describe("Last actual period (default: last non-null actuals period for the account)."),
    method: z.string().optional().describe("Projection method label for the header (e.g. 'hold')."),
    title: z.string().optional().describe("Report title (default 'Cash Forecast')."),
  },
  handler: async ({ fy, account, cutover_per, method, title }) => {
    const ws = requireWs();
    const facts = readEntry<FactRow>(ws, FACTS_ENTRY);
    const acct = account ?? "Operating Cash";

    const row = (version: string) =>
      facts.find((r) => r["fiscal year"] === fy && r.version === version && r.account === acct);
    const actualsRow = row("actuals");
    const forecastRow = row("Forecast");
    const latestRow = row("Latest estimate");

    let cut = cutover_per;
    if (cut === undefined) {
      cut = 0;
      for (let n = 1; n <= 12; n++) if (actualsRow?.[perKey(n)] != null) cut = n;
    }

    const months = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return {
        per: n,
        actual: actualsRow?.[perKey(n)] ?? null,
        forecast: forecastRow?.[perKey(n)] ?? null,
        latest: latestRow?.[perKey(n)] ?? null,
      };
    });

    const workspace = ws.getMetadata()?.workspace ?? "Workspace";
    const html = buildCashForecastReportHtml({
      workspace,
      title: title ?? "Cash Forecast",
      meta: { fy, account: acct, method: method ?? "hold", cutover: cut },
      months,
    });
    return { content: [{ type: "text" as const, text: html }] };
  },
});
