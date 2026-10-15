import { describe, expect, test } from "bun:test";
import {
  stage,
  parseNumber,
  splitCsvLines,
  parseCsvLine,
  buildCellMap,
  colIndexToLetters,
  cellMapToGrid,
  gridToCsv,
  slugify,
  cellGridTitle,
} from "./stage";

describe("parseNumber", () => {
  test("strips currency, commas, and percent", () => {
    expect(parseNumber("$41,200.00")).toBe(41200);
    expect(parseNumber("84")).toBe(84);
    expect(parseNumber("59.2%")).toBe(59.2);
    expect(parseNumber("$3,125.00")).toBe(3125);
  });
  test("handles accounting negatives in parentheses", () => {
    expect(parseNumber("($3,200.00)")).toBe(-3200);
    expect(parseNumber("-1,234")).toBe(-1234);
  });
  test("rejects non-numbers", () => {
    expect(parseNumber("IC-1001")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("2026-07-01")).toBeNull();
  });
});

describe("CSV line parsing", () => {
  test("respects quoted commas", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });
  test("keeps embedded newlines inside quotes", () => {
    const lines = splitCsvLines('"a\nb",c\n1,2');
    expect(lines).toEqual(['"a\nb",c', "1,2"]);
  });
});

describe("stage — header detection", () => {
  test("skips title/note preamble and finds the real header", () => {
    const csv = [
      "Some Report,,,,,",
      "A note about the data,,,,,",
      ",,,,,",
      "Txn ID,Amount,Status",
      "IC-1,$10.00,Allocated",
      "IC-2,$20.50,Pending",
    ].join("\n");
    const s = stage(csv);
    expect(s.tables).toHaveLength(1);
    expect(s.tables[0].columns).toEqual(["Txn ID", "Amount", "Status"]);
    expect(s.tables[0].headerIndex).toBe(3);
  });

  test("clean CSV header at row 0 works", () => {
    const s = stage("a,b,c\n1,2,3\n4,5,6");
    expect(s.tables).toHaveLength(1);
    expect(s.tables[0].columns).toEqual(["a", "b", "c"]);
  });
});

describe("stage — type inference", () => {
  test("casts currency/number/percent, leaves strings", () => {
    const csv = 'Entity,Amount,Rate,Status\nA,"$1,000.00",2.0%,ok\nB,"$500.00",3.5%,hold';
    const t = stage(csv).tables[0];
    expect(t.columnTypes).toEqual({ Entity: "string", Amount: "number", Rate: "number", Status: "string" });
    expect(t.rows[0]).toEqual({ Entity: "A", Amount: 1000, Rate: 2, Status: "ok" });
  });
});

describe("stage — multi-table split", () => {
  const csv = [
    "Workbook,,,,,,",
    "Subtitle,,,,,,",
    ",,,,,,",
    "Headcount by Entity,,,,",
    "Entity,Headcount,% of Total,",
    "A,10,50.0%,",
    "B,10,50.0%,",
    "Total,20,,",
    ",,,,,",
    "Revenue by Entity,,,,",
    "Entity,Revenue,Fee,",
    "A,$100,2.0%,",
    "B,$200,3.0%,",
    "Note: something else here,,,,",
  ].join("\n");

  test("splits stacked tables and drops totals/notes/titles", () => {
    const s = stage(csv);
    expect(s.multiTable).toBe(true);
    expect(s.tables).toHaveLength(2);

    expect(s.tables[0].columns).toEqual(["Entity", "Headcount", "% of Total"]);
    expect(s.tables[0].rows).toEqual([
      { Entity: "A", Headcount: 10, "% of Total": 50 },
      { Entity: "B", Headcount: 10, "% of Total": 50 },
    ]);

    expect(s.tables[1].columns).toEqual(["Entity", "Revenue", "Fee"]);
    expect(s.tables[1].rows).toEqual([
      { Entity: "A", Revenue: 100, Fee: 2 },
      { Entity: "B", Revenue: 200, Fee: 3 },
    ]);
  });
});

describe("cell-address map (json_cells)", () => {
  test("column index → spreadsheet letters", () => {
    expect(colIndexToLetters(0)).toBe("a");
    expect(colIndexToLetters(1)).toBe("b");
    expect(colIndexToLetters(25)).toBe("z");
    expect(colIndexToLetters(26)).toBe("aa");
  });

  test("maps non-empty cells to a1-style addresses, skips blanks", () => {
    const csv = [
      "Title,",
      "Name,Amount",
      "A,$10.00",
      ",,",
      "B,$20.00",
    ].join("\n");
    const map = buildCellMap(csv);
    expect(map).not.toBeNull();
    expect(map!.cells).toEqual({
      a1: "Title",
      a2: "Name",
      b2: "Amount",
      a3: "A",
      b3: "$10.00",
      a5: "B",
      b5: "$20.00",
    });
    expect(map!.rowCount).toBe(5);
  });
});

describe("cell-map synthesis helpers", () => {
  test("cellMapToGrid rebuilds a dense grid (round-trip)", () => {
    const cells = {
      a1: "Title",
      a2: "Name",
      b2: "Amount",
      a3: "A",
      b3: "$10.00",
      b4: "$20.00",
    };
    const grid = cellMapToGrid(cells);
    expect(grid.length).toBe(4);
    expect(grid[0]).toEqual(["Title", ""]);
    expect(grid[1]).toEqual(["Name", "Amount"]);
    expect(grid[2]).toEqual(["A", "$10.00"]);
    expect(grid[3]).toEqual(["", "$20.00"]);
  });

  test("gridToCsv quotes cells containing commas", () => {
    const csv = gridToCsv([["a", "$2,000.00"], ["b", "plain"]]);
    expect(csv).toBe('a,"$2,000.00"\nb,plain');
  });

  test("slugify produces name-safe slugs", () => {
    expect(slugify("Net Intercompany Position (Allocated + Pending items only)")).toBe(
      "net_intercompany_position",
    );
    expect(slugify("")).toBeNull();
  });

  test("cellGridTitle finds the preceding single-cell row", () => {
    const grid = [
      ["Report Title", "", ""],
      ["", "", ""],
      ["Headcount by Entity", "", ""],
      ["Entity", "Headcount", "%"],
    ];
    expect(cellGridTitle(grid, 3)).toBe("Headcount by Entity");
    expect(cellGridTitle(grid, 0)).toBeNull();
  });
});
