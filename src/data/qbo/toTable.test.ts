import { describe, expect, test } from "bun:test";
import { buildCellMap } from "../stage";
import { recognizeQboReport } from "./recognize";
import { parseQboReport, qboReportToTable, qboEntrySuffix } from "./toTable";

const GL_SAMPLE = `Sandbox Company US 1474,,,,,,,,,
General Ledger List,,,,,,,,,
"May 1-31, 2026",,,,,,,,,
,,,,,,,,
,Distribution account,Transaction date,Description,Name,Transaction ID,Num,Balance,Debit,Credit
Checking,,,,,,,,,
,Beginning Balance,,,,,,,"4,179.36",,
,Checking,05/04/2026,,Kate Whelan,17,1008,"4,490.76",225.00,
,Checking,05/06/2026,,Amy's Bird Sanctuary,72,,"4,595.76",105.00,
,Checking,05/08/2026,,Hicks Hardware,79,7,"4,345.76",,250.00
Total for Checking,,,,,,,,"$3,096.35","$5,151.21"
Savings,,,,,,,,,
,Savings,05/25/2026,Opening Balance,,5,,600.00,600.00,
,Savings,05/29/2026,Money to savings,,121,,800.00,200.00,
Total for Savings,,,,,,,,$800.00,$0.00
Job Materials,,,,,,,,,
Fountains and Garden Lighting,,,,,,,,,
,Fountains and Garden Lighting,05/07/2026,Rock Fountain,Amy's Bird Sanctuary,67,1021,275.00,,275.00
Total for Fountains and Garden Lighting,,,,,,,,$0.00,$275.00
Total for Job Materials with sub-accounts,,,,,,,,$0.00,$275.00
"Accrual Basis Saturday, September 12, 2026 09:10 PM GMTZ",,,,,,,,,`;

function cells(): Record<string, string> {
  const cm = buildCellMap(GL_SAMPLE);
  if (!cm) throw new Error("buildCellMap returned null");
  return cm.cells;
}

describe("qbo data-table path (recognize → parse → table)", () => {
  test("flattens a General Ledger report into a normalized table", () => {
    const rec = recognizeQboReport(cells());
    expect(rec?.kind).toBe("general_ledger_list");

    const report = parseQboReport(rec!.kind, cells(), "gl.csv");
    const table = qboReportToTable(rec!.kind, report);

    expect(table.columns).toEqual([
      "date", "account", "parent", "accountType", "name", "description",
      "num", "txnId", "debit", "credit", "amount",
    ]);

    // One row per GL line (3 checking + 2 savings + 1 fountains).
    expect(table.rows.length).toBe(6);

    // First line: checking 05/04/2026 debit 225.
    const first = table.rows[0];
    expect(first[0]).toBe("2026-05-04");
    expect(first[1]).toBe("Checking");
    expect(first[2]).toBe("");
    expect(first[8]).toBe("225");

    // Credit row renders amount as negative.
    const creditRow = table.rows[2];
    expect(creditRow[1]).toBe("Checking");
    expect(creditRow[9]).toBe("250");
    expect(creditRow[10]).toBe("-250");

    // Nested account carries its parent.
    const fountains = table.rows.find((r) => r[1] === "Fountains and Garden Lighting");
    expect(fountains![2]).toBe("Job Materials");
  });

  test("entry suffix is stable per report kind", () => {
    expect(qboEntrySuffix("general_ledger_list")).toBe("gl");
    expect(qboEntrySuffix("journal")).toBe("journal");
    expect(qboEntrySuffix("chart_of_accounts")).toBe("coa");
  });
});