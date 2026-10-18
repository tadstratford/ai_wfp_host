import { describe, it, expect } from "bun:test";
import { monthLabel, splitAmount, computeAllocationLines } from "./allocation";

describe("monthLabel", () => {
  it("normalizes periods to month names", () => {
    expect(monthLabel("2026-05")).toBe("May");
    expect(monthLabel("May")).toBe("May");
    expect(monthLabel("05")).toBe("May");
    expect(monthLabel("5")).toBe("May");
    expect(monthLabel("Dec")).toBe("Dec");
    expect(monthLabel("nonsense")).toBeNull();
  });
});

describe("splitAmount", () => {
  it("ties exactly to the total with residual on the largest share", () => {
    const shares = splitAmount(29800, [
      { entity: "Alpha", percent: 40 },
      { entity: "Beta", percent: 35 },
      { entity: "Omega", percent: 25 },
    ]);
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    expect(Math.abs(sum - 29800)).toBeLessThan(0.01);
    expect(shares).toHaveLength(3);
  });

  it("assigns cents-precision shares", () => {
    const shares = splitAmount(100, [{ entity: "A", percent: 33.33 }]);
    expect(shares[0].amount).toBeCloseTo(100, 2);
  });
});

describe("computeAllocationLines", () => {
  it("emits balanced debit/credit lines with the entity as class", () => {
    const lines = computeAllocationLines({
      total: 29800,
      percentages: [
        { entity: "Alpha Growth Fund LP", percent: 40 },
        { entity: "Beta Income Fund LP", percent: 35 },
        { entity: "Omega Real Estate Fund LP", percent: 25 },
      ],
      debitAccount: "Shared Services",
      creditAccount: "Shared Services Clearing",
      description: "May allocation",
    });
    const debits = lines.filter((l) => l.posting_type === "Debit");
    const credits = lines.filter((l) => l.posting_type === "Credit");
    const sumDebits = debits.reduce((s, l) => s + l.amount, 0);
    const sumCredits = credits.reduce((s, l) => s + l.amount, 0);
    expect(Math.abs(sumDebits - sumCredits)).toBeLessThan(0.01);
    expect(debits).toHaveLength(3);
    expect(credits).toHaveLength(1);
    expect(debits.every((l) => l.class && l.account === "Shared Services")).toBe(true);
    expect(credits[0].account).toBe("Shared Services Clearing");
    expect(credits[0].class).toBeUndefined();
  });
});
