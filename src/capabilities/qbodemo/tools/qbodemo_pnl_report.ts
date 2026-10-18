import { z } from "zod";
import { defineTool } from "../../tool";
import { monthRange } from "../scope";
import { demoQbo } from "../store";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (period: string): string => {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

export default defineTool({
  name: "qbodemo_pnl_report",
  description: "Fetches the Profit & Loss (income statement) from the DEMO QuickBooks company for a date range. Returns column headers plus rows (Income/Expense sections, line items, and Net Income) so you can render a table. Use summarize_column_by \"Months\" for a month-by-month breakdown.",
  class: "read",
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
    summarize_column_by: z.enum(["Total", "Months"]).optional().describe("Column grouping. Use \"Months\" for a month-by-month breakdown. Defaults to \"Total\"."),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
  },
  handler: async ({ start_date, end_date, summarize_column_by }) => {
    const byMonth = summarize_column_by === "Months";
    const months = byMonth ? monthRange(start_date, end_date) : [];
    const columns = byMonth ? months.map((m) => monthLabel(m.period)) : ["Total"];

    const valueFor = (accountId: string, colIdx: number): number => {
      if (!byMonth) return demoQbo.amountFor(accountId, start_date, end_date);
      const period = months[colIdx].period;
      return demoQbo.amountForPeriod(accountId, period);
    };

    const rows: Array<{ kind: string; label: string; values: Array<{ column: string; value: number }> }> = [];
    const net = new Array<number>(columns.length).fill(0);

    const income = demoQbo.flowAccounts().filter((a) => a.Classification === "Revenue");
    const expense = demoQbo.flowAccounts().filter((a) => a.Classification === "Expense");

    rows.push({ kind: "section", label: "Income", values: columns.map((c) => ({ column: c, value: 0 })) });
    for (const acct of income) {
      const values = columns.map((c, i) => {
        const v = valueFor(acct.Id, i);
        net[i] += v;
        return { column: c, value: Math.round(v * 100) / 100 };
      });
      rows.push({ kind: "data", label: acct.Name, values });
    }

    rows.push({ kind: "section", label: "Expense", values: columns.map((c) => ({ column: c, value: 0 })) });
    for (const acct of expense) {
      const values = columns.map((c, i) => {
        const v = valueFor(acct.Id, i);
        net[i] -= v;
        return { column: c, value: Math.round(v * 100) / 100 };
      });
      rows.push({ kind: "data", label: acct.Name, values });
    }

    rows.push({
      kind: "summary",
      label: "Net Income",
      values: columns.map((c, i) => ({ column: c, value: Math.round(net[i] * 100) / 100 })),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          reportName: "ProfitAndLoss",
          currency: "USD",
          company: demoQbo.companyName(),
          startPeriod: start_date,
          endPeriod: end_date,
          summarizeColumnBy: byMonth ? "Months" : "Total",
          accountingMethod: "Accrual",
          columns,
          rows,
          netIncome: Math.round(net[net.length - 1] * 100) / 100,
          note: null,
        }),
      }],
    };
  },
});
