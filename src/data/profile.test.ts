import { describe, expect, test } from "bun:test";
import { parseAmount, profileTable, detectFootings, checkFooting } from "./profile";

describe("parseAmount", () => {
  test("parses currency and plain numbers", () => {
    expect(parseAmount("$9,865.91")).toBeCloseTo(9865.91);
    expect(parseAmount("1,250.00")).toBeCloseTo(1250);
    expect(parseAmount(10935.79)).toBeCloseTo(10935.79);
    expect(parseAmount("(3,200.00)")).toBeCloseTo(-3200);
  });

  test("treats accounting placeholders as zero", () => {
    expect(parseAmount("$-")).toBe(0);
    expect(parseAmount("-")).toBe(0);
    expect(parseAmount("–")).toBe(0);
    expect(parseAmount("( )")).toBe(0);
  });

  test("treats blank and non-numeric as missing", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });
});

describe("profileTable", () => {
  const schedule = {
    name: "dead_deals_report_dead_deals",
    columns: ["Deal Name", "Fund I Expenses", "Fund II Expenses", "Total Expenses", "EBITDA ($m)"],
    columnTypes: {
      "Deal Name": "string",
      "Fund I Expenses": "string",
      "Fund II Expenses": "string",
      "Total Expenses": "number",
      "EBITDA ($m)": "number",
    },
    rows: [
      { "Deal Name": "McQ", "Fund I Expenses": "$9,865.91", "Fund II Expenses": "$-", "Total Expenses": 9865.91, "EBITDA ($m)": 5 },
      { "Deal Name": "Ironwave", "Fund I Expenses": "$-", "Fund II Expenses": "$10,935.79", "Total Expenses": 10935.79, "EBITDA ($m)": 8 },
      { "Deal Name": "AFEX", "Fund I Expenses": "", "Fund II Expenses": "", "Total Expenses": null, "EBITDA ($m)": null },
    ],
  };

  test("computes per-column completeness", () => {
    const p = profileTable(schedule);
    const total = p.columns.find((c) => c.column === "Total Expenses")!;
    expect(total.nonNull).toBe(2);
    expect(total.nullCount).toBe(1);
    expect(total.distinct).toBe(2);
  });

  test("reports no footings unless explicitly asked", () => {
    const p = profileTable(schedule);
    expect(p.footings).toEqual([]);
  });

  test("verifies an explicit footing that holds", () => {
    const p = profileTable(schedule, {
      footings: [{ leftColumn: "Total Expenses", rightColumns: ["Fund I Expenses", "Fund II Expenses"] }],
    });
    expect(p.footings.length).toBe(1);
    expect(p.footings[0].holds).toBe(true);
    expect(p.footings[0].mismatchRows).toBe(0);
  });

  test("flags an explicit footing that breaks", () => {
    const broken = {
      ...schedule,
      rows: [
        { "Deal Name": "McQ", "Fund I Expenses": "$9,865.91", "Fund II Expenses": "$-", "Total Expenses": 9865.91, "EBITDA ($m)": 5 },
        { "Deal Name": "Ironwave", "Fund I Expenses": "$-", "Fund II Expenses": "$7,194.68", "Total Expenses": 10935.79, "EBITDA ($m)": 8 },
      ],
    };
    const p = profileTable(broken, {
      footings: [{ leftColumn: "Total Expenses", rightColumns: ["Fund I Expenses", "Fund II Expenses"] }],
    });
    expect(p.footings.length).toBe(1);
    expect(p.footings[0].holds).toBe(false);
    expect(p.footings[0].mismatchRows).toBe(1);
  });

  test("counts exact-duplicate rows", () => {
    const dup = { ...schedule, rows: [...schedule.rows, schedule.rows[0]] };
    expect(profileTable(dup).duplicateRows).toBe(1);
  });
});

describe("checkFooting", () => {
  test("reports a clean footing", () => {
    const f = checkFooting(
      [{ a: 2, b: 3, total: 5 }, { a: 1, b: 4, total: 5 }],
      "total",
      ["a", "b"],
    );
    expect(f.holds).toBe(true);
  });

  test("reports a broken footing", () => {
    const f = checkFooting(
      [{ a: 2, b: 3, total: 5 }, { a: 1, b: 4, total: 99 }],
      "total",
      ["a", "b"],
    );
    expect(f.holds).toBe(false);
    expect(f.mismatchRows).toBe(1);
  });
});

describe("detectFootings", () => {
  test("returns nothing for a table with no numeric footings", () => {
    const out = detectFootings({
      columns: ["Name", "Amount"],
      rows: [{ Name: "A", Amount: 1 }, { Name: "B", Amount: 2 }],
    });
    expect(out).toEqual([]);
  });
});
