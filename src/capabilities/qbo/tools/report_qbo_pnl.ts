import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, statementHtml, renderStatementHtml, monthlyPnl, fetchReportWithFallback, saveReportTable, saveStatementTable } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "report_qbo_pnl",
  description: "Fetches the QuickBooks Online Profit & Loss report and renders it as a self-contained, native-QBO-style HTML statement (bold section headers, indented line items, ruled subtotal rows). Deterministic — no LLM. Returns HTML text for a following chat_download(data=\"{{result}}\") step. summarize_column_by \"Months\" renders a month-by-month statement; when the company rejects the Months grouping, it fetches one single-month P&L per month and merges them into columns. When save_to is set, also emits a structured tabular version of the statement rows (json_array) into that workspace data entry so \"save to data\" persists real data.",
  class: "read",
  output: { metaType: "text", tabular: false },
  durable: true,
  report: true,
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    summarize_column_by: z.enum(["Total", "Days", "Weeks", "Months", "Quarterly", "Annual"]).optional().describe("Column grouping. Use \"Months\" for a month-by-month breakdown. Defaults to \"Total\"."),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
    save_to: z.string().optional().describe("Optional workspace data entry name to also write the structured statement rows to (json_array)."),
  },
  handler: async ({ start_date, end_date, summarize_column_by, accounting_method, save_to }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const method = accounting_method ?? "Accrual";
    const columnBy = summarize_column_by ?? "Total";

    if (columnBy === "Months") {
      try {
        const report = await client.profitAndLoss(start_date, end_date, {
          summarizeColumnBy: "Months",
          accountingMethod: method,
        });
        if (save_to) saveReportTable(save_to, report);
        const html = statementHtml(report, "Profit and Loss", method, null);
        return { content: [{ type: "text" as const, text: html }] };
      } catch {
        // "Months" grouping rejected — assemble per-month columns below.
      }
      const { columns, rows, currency } = await monthlyPnl(client, start_date, end_date, method);
      if (save_to) saveStatementTable(save_to, columns, rows);
      const html = renderStatementHtml({
        title: "Profit and Loss",
        method,
        currency,
        period: `${start_date} – ${end_date}`,
        columns,
        rows,
        note: null,
      });
      return { content: [{ type: "text" as const, text: html }] };
    }

    const { report, note } = await fetchReportWithFallback(client, "pnl", start_date, end_date, columnBy, method);
    if (save_to) saveReportTable(save_to, report);
    const html = statementHtml(report, "Profit and Loss", method, note);
    return { content: [{ type: "text" as const, text: html }] };
  },
});
