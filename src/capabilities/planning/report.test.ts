import { describe, it, expect } from "bun:test";
import { buildPlanVarianceReportHtml } from "@capabilities/planning/report";

describe("buildPlanVarianceReportHtml", () => {
  const input = {
    workspace: "Test Co",
    title: "Budget vs Actual",
    meta: { fy: 2026, base: "actuals", compare: "budget1", from: 1, through: 6 },
    lines: [
      {
        account: "Revenue",
        kind: "income" as const,
        base: 120000,
        compare: 100000,
        variance: 20000,
        variancePct: 20,
        favorable: true,
        months: [
          { per: 1, base: 20000, compare: 18000 },
          { per: 2, base: 20000, compare: null },
        ],
      },
      {
        account: "Salaries",
        kind: "expense" as const,
        base: 55000,
        compare: 50000,
        variance: 5000,
        variancePct: 10,
        favorable: false,
        months: [{ per: 1, base: 9000, compare: 8000 }],
      },
    ],
    netIncome: {
      account: "Net Income",
      kind: "income" as const,
      base: 65000,
      compare: 50000,
      variance: 15000,
      variancePct: 30,
      favorable: true,
      months: [],
    },
  };

  it("produces a self-contained deterministic HTML document", () => {
    const html = buildPlanVarianceReportHtml(input);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Co");
    expect(html).toContain("Budget vs Actual");
    expect(html).toContain("Deterministic");
    expect(html).toContain("no AI");
  });

  it("groups lines under Income/Expense sections and renders a Net Income summary", () => {
    const html = buildPlanVarianceReportHtml(input);
    expect(html).toContain("Income");
    expect(html).toContain("Expense");
    expect(html).toContain("Net Income");
  });

  it("colors variance favorable/unfavorable", () => {
    const html = buildPlanVarianceReportHtml(input);
    expect(html).toContain("fav");
    expect(html).toContain("unfav");
  });

  it("renders per-month drill-down detail", () => {
    const html = buildPlanVarianceReportHtml(input);
    expect(html).toContain("P1");
    expect(html).toContain("Period");
    expect(html).toContain("Actual");
    expect(html).toContain("Budget");
  });

  it("renders an empty state when there are no lines", () => {
    const html = buildPlanVarianceReportHtml({ ...input, lines: [] });
    expect(html).toContain("No data to display");
  });
});
