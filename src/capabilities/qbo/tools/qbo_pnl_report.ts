import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, formatReportRows, fetchReportWithFallback } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_pnl_report",
  description: "Fetches the Profit & Loss (income statement) report from QuickBooks Online for a date range. Returns column headers plus rows (sections, line items, and Gross Profit / Net Income summaries) so the LLM can render a table. Use summarize_column_by \"Months\" only when the user explicitly asks for a month-by-month breakdown.",
  class: "read",
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    summarize_column_by: z.enum(["Total", "Days", "Weeks", "Months", "Quarterly", "Annual"]).optional().describe("Column grouping. Use \"Months\" for a month-by-month breakdown. Defaults to \"Total\"."),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
  },
  handler: async ({ start_date, end_date, summarize_column_by, accounting_method }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const method = accounting_method ?? "Accrual";
    const { report, columnBy, note: fallbackNote } = await fetchReportWithFallback(
      client, "pnl", start_date, end_date, summarize_column_by ?? "Total", method,
    );

    const header = report?.Header ?? {};
    const { columns, rows } = formatReportRows(report);

    const netRow = rows.find((r) => r.kind === "summary" && /net income/i.test(r.label));
    const netIncome = netRow ? netRow.values[netRow.values.length - 1]?.value ?? null : null;

    // A report with section/summary headers but no line items means the period
    // had no transactions — surface that explicitly instead of forcing the LLM
    // to infer emptiness from an all-empty skeleton.
    const hasDataRows = rows.some((r) => r.kind === "data");
    const note = fallbackNote ?? (hasDataRows ? null : "No transactions found in this period.");

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          reportName: header.ReportName ?? "ProfitAndLoss",
          currency: header.Currency ?? "",
          startPeriod: header.StartPeriod ?? start_date,
          endPeriod: header.EndPeriod ?? end_date,
          summarizeColumnBy: columnBy,
          accountingMethod: method,
          columns,
          rows,
          netIncome,
          note,
        }),
      }],
    };
  },
});
