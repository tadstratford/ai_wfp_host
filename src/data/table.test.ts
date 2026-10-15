import { describe, it, expect } from "bun:test";
import { extractTable } from "./table";

describe("extractTable", () => {
  it("passes a bare array through unchanged", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    expect(extractTable(rows)).toEqual(rows);
  });

  it("unwraps a rows envelope", () => {
    expect(extractTable({ name: "x", rows: [{ a: 1 }, { a: 2 }] })).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it("flattens aggregate groups (key + measures + count)", () => {
    const raw = {
      name: "t",
      total_groups: 2,
      groups: [
        { key: { "GL Account": "1200" }, measures: { Sum: 144660 }, count: 4 },
        { key: { "GL Account": "6400" }, measures: { Sum: 68790 }, count: 4 },
      ],
    };
    expect(extractTable(raw)).toEqual([
      { "GL Account": "1200", Sum: 144660, count: 4 },
      { "GL Account": "6400", Sum: 68790, count: 4 },
    ]);
  });

  it("returns null for a non-tabular object", () => {
    expect(extractTable({ a: 1, b: 2 })).toBeNull();
    expect(extractTable("just text")).toBeNull();
    expect(extractTable(null)).toBeNull();
  });
});
