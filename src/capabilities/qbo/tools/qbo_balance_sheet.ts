import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, formatReportRows, fetchReportWithFallback } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_balance_sheet",
  description: "Fetches the Balance Sheet report from QuickBooks Online for a date range. Returns assets, liabilities, and equity (with Total Assets / Total Liabilities and Equity summaries) so the LLM can render a table.",
  class: "read",
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD). For an as-of snapshot, use the same value as start_date."),
    summarize_column_by: z.enum(["Total", "Days", "Weeks", "Months", "Quarterly", "Annual"]).optional().describe("Column grouping. Defaults to \"Total\" (single as-of column)."),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
  },
  handler: async ({ start_date, end_date, summarize_column_by, accounting_method }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const method = accounting_method ?? "Accrual";
    const { report, columnBy, note } = await fetchReportWithFallback(
      client, "balance", start_date, end_date, summarize_column_by ?? "Total", method,
    );

    const header = report?.Header ?? {};
    const { columns, rows } = formatReportRows(report);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          reportName: header.ReportName ?? "BalanceSheet",
          currency: header.Currency ?? "",
          startPeriod: header.StartPeriod ?? start_date,
          endPeriod: header.EndPeriod ?? end_date,
          summarizeColumnBy: columnBy,
          accountingMethod: method,
          columns,
          rows,
          note,
        }),
      }],
    };
  },
});
