import { describe, expect, test } from "bun:test";
import { countRows, stageLarge, readCsvPage } from "./stage";
import { aggregateCells } from "./stats";

describe("countRows", () => {
  test("counts logical rows, respecting quoted newlines", () => {
    expect(countRows("a,b\nc,d")).toBe(2);
    expect(countRows("a,b\n")).toBe(1);
    expect(countRows("")).toBe(0);
    expect(countRows('"a\nb",c\n1,2')).toBe(2);
  });
});

const JOURNAL = [
  "Some Journal Report,,,,,,",
  ",,,,,,",
  "Date,Transaction Type,Num,Name,Account,Debit,Credit",
  "2026-06-01,Journal Entry,JE-1,Acme Corp,Checking,100.00,",
  ",,,,Sales,,100.00",
  "2026-06-02,Journal Entry,JE-2,Beta LLC,Savings,50.00,",
  ",,,,Sales,,50.00",
  "Total for 06/30/2025,,,,,1000.00,1000.00",
  ",,,,,,",
].join("\n");

describe("stageLarge", () => {
  test("detects header, columns, row count, and skips report scaffolding", () => {
    const s = stageLarge(JOURNAL);
    expect(s).not.toBeNull();
    expect(s!.columns).toEqual(["Date", "Transaction Type", "Num", "Name", "Account", "Debit", "Credit"]);
    expect(s!.rowCount).toBe(4);
    expect(s!.headerIndex).toBe(2);
    expect(s!.columnTypes["Debit"]).toBe("number");
    expect(s!.columnTypes["Credit"]).toBe("number");
    expect(s!.columnTypes["Account"]).toBe("string");
    // key columns: sparse leading string columns (Date/Type/Num/Name), not Account.
    expect(s!.keyColumns).toEqual(["Date", "Transaction Type", "Num", "Name"]);
  });

  test("handles a clean large table", () => {
    const lines = ["a,b,c"];
    for (let i = 0; i < 1100; i++) lines.push(`${i},${i + 1},x`);
    const s = stageLarge(lines.join("\n"));
    expect(s).not.toBeNull();
    expect(s!.rowCount).toBe(1100);
    expect(s!.columns).toEqual(["a", "b", "c"]);
  });
});

describe("readCsvPage", () => {
  test("pages rows and forward-fills continuation lines", () => {
    const opts = { headerIndex: 2, keyColumns: ["Date", "Transaction Type", "Num", "Name"] };
    const page0 = readCsvPage(JOURNAL, { ...opts, offset: 0, limit: 2 });
    expect(page0.rows).toHaveLength(2);
    expect(page0.rows[0][0]).toBe("2026-06-01");
    expect(page0.rows[0][3]).toBe("Acme Corp");
    // Continuation row: keys forward-filled from the entry header line.
    expect(page0.rows[1][0]).toBe("2026-06-01");
    expect(page0.rows[1][1]).toBe("Journal Entry");
    expect(page0.rows[1][2]).toBe("JE-1");
    expect(page0.rows[1][3]).toBe("Acme Corp");
    expect(page0.rows[1][4]).toBe("Sales");

    const page1 = readCsvPage(JOURNAL, { ...opts, offset: 2, limit: 2 });
    expect(page1.rows[0][2]).toBe("JE-2");
    expect(page1.rows[1][2]).toBe("JE-2");
    expect(page1.rows[1][3]).toBe("Beta LLC");
  });
});

describe("aggregateCells", () => {
  test("groups by a column and sums numeric measures", () => {
    const columns = ["Account", "Debit", "Credit"];
    const rows = [
      ["Checking", "100.00", ""],
      ["Sales", "", "100.00"],
      ["Savings", "50.00", ""],
      ["Sales", "", "50.00"],
    ];
    const { groups, totalGroups } = aggregateCells(columns, rows, ["Account"], [
      { column: "Debit", fn: "sum" },
      { column: "Credit", fn: "sum" },
    ]);
    expect(totalGroups).toBe(3);

    const byKey = new Map(groups.map((g) => [g.key!.Account, g]));
    expect(byKey.get("Sales")!.count).toBe(2);
    expect(byKey.get("Sales")!.measures["sum_Credit"]).toBe(150);
    expect(byKey.get("Checking")!.measures["sum_Debit"]).toBe(100);
    expect(byKey.get("Checking")!.measures["sum_Credit"]).toBeNull();
    expect(byKey.get("Savings")!.measures["sum_Debit"]).toBe(50);
  });

  test("counts rows when grouping without measures needing numbers", () => {
    const columns = ["Account", "Debit"];
    const rows = [
      ["Checking", "100.00"],
      ["Checking", "200.00"],
      ["Savings", "50.00"],
    ];
    const { groups } = aggregateCells(columns, rows, ["Account"], [
      { column: "Debit", fn: "count" },
    ]);
    const byKey = new Map(groups.map((g) => [g.key!.Account, g]));
    expect(byKey.get("Checking")!.measures["count_Debit"]).toBe(2);
    expect(byKey.get("Savings")!.measures["count_Debit"]).toBe(1);
  });

  test("multiple measures on the same column don't inflate counts or avg", () => {
    const columns = ["Account", "Amount"];
    const rows = [
      ["Checking", "100.00"],
      ["Checking", "200.00"],
      ["Savings", "50.00"],
      ["Savings", ""],
    ];
    const { groups } = aggregateCells(columns, rows, ["Account"], [
      { column: "Amount", fn: "count" },
      { column: "Amount", fn: "sum" },
      { column: "Amount", fn: "avg" },
    ]);
    const byKey = new Map(groups.map((g) => [g.key!.Account, g]));

    const checking = byKey.get("Checking")!;
    expect(checking.count).toBe(2); // 2 rows
    expect(checking.measures["count_Amount"]).toBe(2); // non-null values
    expect(checking.measures["sum_Amount"]).toBe(300);
    expect(checking.measures["avg_Amount"]).toBe(150);

    const savings = byKey.get("Savings")!;
    expect(savings.count).toBe(2); // 2 rows, one null amount
    expect(savings.measures["count_Amount"]).toBe(1); // 1 non-null
    expect(savings.measures["sum_Amount"]).toBe(50);
    expect(savings.measures["avg_Amount"]).toBe(50);
  });
});
