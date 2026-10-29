import { describe, expect, test } from "bun:test";
import { buildCellMap } from "../stage";
import { recognizeQboReport } from "./recognize";
import { parseJournal } from "./parseJournal";

// QBO Journal export with a single signed "Amount" column (no Debit/Credit).
// Before the fix, parseJournal computed amount = debit − credit with no
// debit/credit columns, so every line's amount collapsed to 0.
const JOURNAL_AMOUNT_SAMPLE = `Sandbox Company US 1474,,,,,,
Journal,,,,,,
"May 1-31, 2026",,,,,,
,,,,,,
Date,Transaction Type,Num,Name,Memo/Description,Split,Amount
05/04/2026,Journal,1008,Kate Whelan,,Sales,225.00
05/08/2026,Journal,7,Hicks Hardware,,Accounts Payable,-250.00`;

function cells(): Record<string, string> {
  const cm = buildCellMap(JOURNAL_AMOUNT_SAMPLE);
  if (!cm) throw new Error("buildCellMap returned null");
  return cm.cells;
}

describe("parseJournal — single Amount column", () => {
  test("recognizes the Journal report and splits signed Amount into debit/credit", () => {
    expect(recognizeQboReport(cells())?.kind).toBe("journal");

    const j = parseJournal(cells(), "journal-amount.csv");

    // Two journal lines survive.
    expect(j.lines.account.length).toBe(2);

    // +225.00 → debit.
    expect(j.lines.account[0]).toBe("Sales");
    expect(j.lines.debit[0]).toBeCloseTo(225, 2);
    expect(j.lines.credit[0]).toBeCloseTo(0, 2);
    expect(j.lines.amount[0]).toBeCloseTo(225, 2);

    // −250.00 → credit (amount negative, credit positive).
    expect(j.lines.account[1]).toBe("Accounts Payable");
    expect(j.lines.debit[1]).toBeCloseTo(0, 2);
    expect(j.lines.credit[1]).toBeCloseTo(250, 2);
    expect(j.lines.amount[1]).toBeCloseTo(-250, 2);

    // Header fields resolve from the dated line.
    expect(j.headers.date[0]).toBe("2026-05-04");
    expect(j.headers.num[0]).toBe("1008");
    expect(j.headers.name[0]).toBe("Kate Whelan");
  });
});
