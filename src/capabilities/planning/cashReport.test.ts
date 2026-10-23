import { describe, it, expect } from "bun:test";
import { buildCashForecastReportHtml } from "@capabilities/planning/cashReport";

const input = {
  workspace: "Test Co",
  title: "Cash Forecast",
  meta: { fy: 2026, account: "Operating Cash", method: "hold", cutover: 10 },
  months: Array.from({ length: 12 }, (_, i) => ({
    per: i + 1,
    actual: i < 10 ? 500000 + (i + 1) * 1000 : null,
    forecast: i >= 10 ? 511000 : 500000 + (i + 1) * 1000,
    latest: i >= 10 ? 511000 : 500000 + (i + 1) * 1000,
  })),
};

describe("buildCashForecastReportHtml", () => {
  it("produces a self-contained deterministic HTML document", () => {
    const html = buildCashForecastReportHtml(input);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Co");
    expect(html).toContain("Cash Forecast");
    expect(html).toContain("Deterministic");
    expect(html).toContain("no AI");
  });

  it("renders actual, forecast, and latest-estimate columns", () => {
    const html = buildCashForecastReportHtml(input);
    expect(html).toContain("Actual");
    expect(html).toContain("Forecast");
    expect(html).toContain("Latest estimate");
  });

  it("marks the cutover and forecast months", () => {
    const html = buildCashForecastReportHtml(input);
    expect(html).toContain("Cutover");
    expect(html).toContain("tr class=\"forecast\"");
  });

  it("renders a projected year-end summary band", () => {
    const html = buildCashForecastReportHtml(input);
    expect(html).toContain("Projected FY-end cash");
  });

  it("renders an empty state when there are no months", () => {
    const html = buildCashForecastReportHtml({ ...input, months: [] });
    expect(html).toContain("No data to display");
  });
});
