import { describe, expect, test } from "bun:test";
import { matchesClause, applyRowFilter, cellRowMatches } from "./filter";

describe("matchesClause", () => {
  test("numeric comparisons tolerate currency formatting", () => {
    expect(matchesClause("1,234,567", { column: "x", op: "gt", value: 1000000 })).toBe(true);
    expect(matchesClause("$500", { column: "x", op: "lt", value: "1000" })).toBe(true);
    expect(matchesClause(150, { column: "x", op: "gte", value: 150 })).toBe(true);
  });

  test("lexicographic fallback handles ISO dates", () => {
    expect(matchesClause("2025-03-01", { column: "Date", op: "lt", value: "2026-10-22" })).toBe(true);
    expect(matchesClause("2027-01-01", { column: "Date", op: "gt", value: "2026-10-22" })).toBe(true);
  });

  test("string ops", () => {
    expect(matchesClause("x", { column: "Category", op: "eq", value: "x" })).toBe(true);
    expect(matchesClause("x", { column: "Category", op: "ne", value: "y" })).toBe(true);
    expect(matchesClause("z", { column: "Category", op: "in", value: "x,y" })).toBe(false);
    expect(matchesClause("y", { column: "Category", op: "in", value: "x,y" })).toBe(true);
    expect(matchesClause("alpha beta", { column: "Label", op: "contains", value: "beta" })).toBe(true);
    expect(matchesClause("alpha beta", { column: "Label", op: "not_contains", value: "gamma" })).toBe(true);
  });

  test("empty checks", () => {
    expect(matchesClause("", { column: "x", op: "is_empty" })).toBe(true);
    expect(matchesClause("  ", { column: "x", op: "is_empty" })).toBe(true);
    expect(matchesClause("x", { column: "x", op: "not_empty" })).toBe(true);
    expect(matchesClause(null, { column: "x", op: "is_empty" })).toBe(true);
  });
});

describe("applyRowFilter", () => {
  const rows = [
    { Category: "x", Amount: 10 },
    { Category: "y", Amount: 20 },
    { Category: "x", Amount: 30 },
  ];

  test("keeps rows satisfying every clause (AND)", () => {
    const out = applyRowFilter(rows, [{ column: "Category", op: "eq", value: "x" }]);
    expect(out).toHaveLength(2);
  });

  test("returns all rows when filter is empty/undefined", () => {
    expect(applyRowFilter(rows, undefined)).toHaveLength(3);
    expect(applyRowFilter(rows, [])).toHaveLength(3);
  });

  test("combines clauses", () => {
    const out = applyRowFilter(rows, [
      { column: "Category", op: "eq", value: "x" },
      { column: "Amount", op: "gt", value: 15 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]["Amount"]).toBe(30);
  });
});

describe("cellRowMatches", () => {
  const columns = ["Category", "Date"];
  test("matches by column index", () => {
    expect(cellRowMatches(columns, ["x", "2025-01-01"], [{ column: "Category", op: "eq", value: "x" }])).toBe(true);
    expect(cellRowMatches(columns, ["y", "2025-01-01"], [{ column: "Date", op: "lt", value: "2026-01-01" }])).toBe(true);
    expect(cellRowMatches(columns, ["x", "2025-01-01"], [{ column: "Category", op: "eq", value: "y" }])).toBe(false);
  });
});
