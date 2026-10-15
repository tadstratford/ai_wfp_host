import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected, statementHtml, fetchReportWithFallback } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "report_qbo_bs",
  description: "Fetches the QuickBooks Online Balance Sheet report and renders it as a self-contained, native-QBO-style HTML statement (bold section headers, indented line items, ruled subtotal rows). Deterministic — no LLM. Returns HTML text for a following chat_download(data=\"{{result}}\") step.",
  class: "read",
  output: { metaType: "text", tabular: false },
  durable: true,
  report: true,
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
    const { report, note } = await fetchReportWithFallback(
      client, "balance", start_date, end_date, summarize_column_by ?? "Total", method,
    );

    const html = statementHtml(report, "Balance Sheet", method, note);
    return { content: [{ type: "text" as const, text: html }] };
  },
});
