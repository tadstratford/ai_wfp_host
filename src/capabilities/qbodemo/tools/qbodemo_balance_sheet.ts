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
  name: "qbodemo_balance_sheet",
  description: "Fetches the Balance Sheet from the DEMO QuickBooks company. Returns Assets, Liabilities, and Equity. The key asset for a cash forecast is Operating Cash — use summarize_column_by \"Months\" to get month-end bank balances.",
  class: "read",
  inputSchema: {
    start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
    end_date: z.string().describe("Report end date (YYYY-MM-DD). For an as-of snapshot, use the same value as start_date."),
    summarize_column_by: z.enum(["Total", "Months"]).optional().describe("Column grouping. Defaults to \"Total\" (single as-of column)."),
    accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
  },
  handler: async ({ start_date, end_date, summarize_column_by }) => {
    const byMonth = summarize_column_by === "Months";
    const months = byMonth ? monthRange(start_date, end_date) : [monthRange(end_date, end_date)[0]];
    const columns = byMonth ? months.map((m) => monthLabel(m.period)) : ["Total"];

    const cashAt = (period: string): number => {
      const row = demoQbo.cashBalances().find((c) => c.period === period);
      return row?.amount ?? 0;
    };

    const r2 = (n: number) => Math.round(n * 100) / 100;

    // Placeholder non-cash balances (stable across the demo) so the sheet ties.
    const AR = 85000;
    const AP = 42000;
    const CLEARING = 0;

    const rows: Array<{ kind: string; label: string; values: Array<{ column: string; value: number }> }> = [];

    rows.push({ kind: "section", label: "Assets", values: columns.map((c) => ({ column: c, value: 0 })) });
    for (const [label, compute] of [
      ["Operating Cash", cashAt],
      ["Accounts Receivable", () => AR],
    ] as Array<[string, (p: string) => number]>) {
      rows.push({
        kind: "data",
        label,
        values: months.map((m, i) => ({ column: columns[i], value: r2(compute(m.period)) })),
      });
    }

    rows.push({ kind: "section", label: "Liabilities", values: columns.map((c) => ({ column: c, value: 0 })) });
    for (const [label, amount] of [
      ["Accounts Payable", AP],
      ["Shared Services Clearing", CLEARING],
    ] as Array<[string, number]>) {
      rows.push({
        kind: "data",
        label,
        values: months.map((m, i) => ({ column: columns[i], value: r2(amount) })),
      });
    }

    rows.push({ kind: "section", label: "Equity", values: columns.map((c) => ({ column: c, value: 0 })) });
    rows.push({
      kind: "data",
      label: "Retained Earnings",
      values: months.map((m, i) => ({ column: columns[i], value: r2(cashAt(m.period) + AR - AP - CLEARING) })),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          reportName: "BalanceSheet",
          currency: "USD",
          company: demoQbo.companyName(),
          startPeriod: start_date,
          endPeriod: end_date,
          summarizeColumnBy: byMonth ? "Months" : "Total",
          accountingMethod: "Accrual",
          columns,
          rows,
          note: null,
        }),
      }],
    };
  },
});
