import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { buildWorkbook, rowsToAoa, rowsToGrid, sanitizeSheetName, readSheetNames } from "./xlsx";

describe("sanitizeSheetName", () => {
  test("keeps a normal name", () => {
    expect(sanitizeSheetName("Budget 2025")).toBe("Budget 2025");
  });

  test("strips Excel-illegal characters", () => {
    expect(sanitizeSheetName("a[b]*c?d/e\\f")).toBe("a_b__c_d_e_f");
    expect(sanitizeSheetName("it's")).toBe("its");
  });

  test("truncates to 31 chars", () => {
    expect(sanitizeSheetName("x".repeat(40)).length).toBeLessThanOrEqual(31);
  });

  test("never returns an empty name", () => {
    expect(sanitizeSheetName("''")).toBe("Sheet");
  });
});

describe("rowsToAoa", () => {
  test("builds header + body in column order", () => {
    const aoa = rowsToAoa(
      [{ a: 1, b: "x" }, { a: 2, b: "y" }],
      ["b", "a"],
    );
    expect(aoa).toEqual([["b", "a"], ["x", 1], ["y", 2]]);
  });

  test("infers columns from the first row", () => {
    const aoa = rowsToAoa([{ a: 1 }, { a: 2 }]);
    expect(aoa).toEqual([["a"], [1], [2]]);
  });

  test("handles null/undefined/objects", () => {
    const aoa = rowsToAoa([{ a: null, b: undefined, c: { d: 1 } }], ["a", "b", "c"]);
    expect(aoa[1]).toEqual(["", "", '{"d":1}']);
  });
});

describe("rowsToGrid", () => {
  test("projects columns + rows and reports total", () => {
    const g = rowsToGrid([{ a: 1 }, { a: 2 }]);
    expect(g.columns).toEqual(["a"]);
    expect(g.rows).toEqual([[1], [2]]);
    expect(g.total).toBe(2);
  });
});

describe("buildWorkbook", () => {
  test("round-trips sheets to a real .xlsx", () => {
    const buf = buildWorkbook([
      { name: "Sheet1", rows: [{ name: "alice", amt: 10 }, { name: "bob", amt: 20 }] },
      { name: "Sheet2", rows: [{ k: "v" }] },
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Sheet1", "Sheet2"]);

    const s1 = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"]);
    expect(s1).toEqual([{ name: "alice", amt: 10 }, { name: "bob", amt: 20 }]);
  });

  test("de-duplicates repeated sheet names", () => {
    const buf = buildWorkbook([
      { name: "Data", rows: [{ a: 1 }] },
      { name: "Data", rows: [{ a: 2 }] },
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(new Set(wb.SheetNames.map((n) => n.toLowerCase())).size).toBe(2);
  });

  test("empty workbook throws a clear error", () => {
    expect(() => buildWorkbook([])).toThrow("at least one sheet");
  });
});

describe("readSheetNames", () => {
  test("returns sheet names in order", () => {
    const buf = buildWorkbook([
      { name: "B", rows: [{ a: 1 }] },
      { name: "A", rows: [{ a: 2 }] },
    ]);
    expect(readSheetNames(buf)).toEqual(["B", "A"]);
  });
});
