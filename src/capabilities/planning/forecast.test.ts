import { describe, it, expect } from "bun:test";
import { forecastCash } from "@capabilities/planning/forecast";
import { perKey } from "wfp-format";

const balances = (cutover: number) =>
  Array.from({ length: 12 }, (_, i) => ({
    period: `2026-${String(i + 1).padStart(2, "0")}`,
    // grows 100k/month so "trend" is visible
    amount: 500000 + (i + 1) * 100000,
  }));

describe("forecastCash", () => {
  it("projects remaining months flat under 'hold'", () => {
    const fc = forecastCash(balances(9), 2026, 9, "hold");
    expect(fc.actuals[perKey(9)]).toBe(1400000);
    expect(fc.actuals[perKey(10)]).toBeNull();
    expect(fc.forecast[perKey(9)]).toBe(1400000);
    expect(fc.forecast[perKey(10)]).toBe(1400000);
    expect(fc.forecast[perKey(12)]).toBe(1400000);
    expect(fc.latest[perKey(10)]).toBe(1400000);
    expect(fc.latest[perKey(9)]).toBe(1400000);
  });

  it("repeats the last month-over-month change under 'trend'", () => {
    const fc = forecastCash(balances(9), 2026, 9, "trend");
    // cutover balance 1.4M, prior 1.3M → delta +100k/month
    expect(fc.forecast[perKey(10)]).toBe(1500000);
    expect(fc.forecast[perKey(12)]).toBe(1700000);
  });

  it("ignores balances outside the fiscal year", () => {
    const mixed = [
      { period: "2025-12", amount: 1 },
      { period: "2026-06", amount: 600000 },
      { period: "2027-01", amount: 2 },
    ];
    const fc = forecastCash(mixed, 2026, 6, "hold");
    expect(fc.actuals[perKey(6)]).toBe(600000);
    expect(fc.forecast[perKey(7)]).toBe(600000);
    expect(fc.actuals[perKey(1)]).toBeNull();
  });

  it("handles a full-year cutover (nothing to project)", () => {
    const fc = forecastCash(balances(12), 2026, 12, "hold");
    expect(fc.forecast[perKey(12)]).toBe(1700000);
    expect(fc.latest[perKey(12)]).toBe(1700000);
    expect(fc.months.filter((m) => m.per > 12)).toHaveLength(0);
  });

  it("falls back to the last known balance when the cutover month has no data", () => {
    const sparse = [
      { period: "2026-03", amount: 700000 },
      { period: "2026-04", amount: 800000 },
    ];
    const fc = forecastCash(sparse, 2026, 6, "hold");
    expect(fc.forecast[perKey(6)]).toBeNull();
    expect(fc.forecast[perKey(7)]).toBe(800000);
  });
});
