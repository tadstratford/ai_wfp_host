import { describe, expect, test } from "bun:test";
import { detectStatementKind, synthesizeStatement } from "./statementSynth";

const TB_GRID = [
  ["Coreline Ventures LLC", "", ""],
  ["Trial Balance", "", ""],
  ["As of Sep 30, 2026", "", ""],
  ["", "", ""],
  ["Account Name", "Debit", "Credit"],
  ["1000 Bank Checking **", "4567.27", ""],
  ["1020 Intercompany:1021 Due from Coreline I Affiliates Fund, LP (CI)", "20797.92", ""],
  ["1090 Accounts Payable", "", "118085.71"],
  ["TOTAL", "6732231.33", "6732231.33"],
  ["", "", ""],
  ["Accrual Basis Friday, October 30, 2026 04:00 PM GMT-07:00", "", ""],
];

const BS_GRID = [
  ["Coreline Ventures LLC", "", "", ""],
  ["Balance Sheet", "", "", ""],
  ["As of Sep 30, 2026", "", "", ""],
  ["", "", "", ""],
  ["", "Total", "Check", "Notes"],
  ["Assets", "", "", ""],
  ["Bank Accounts", "", "", ""],
  ["1000 Bank Checking **", "4567.27", "0", "1. Cash"],
  ["1001 Citizens Checking - 4279", "250000", "0", "1. Cash"],
  ["Total Bank Accounts", "674694.47", "", ""],
  ["1090 Accounts Payable", "118085.71", "0", "4. AP Aging"],
];

describe("statementSynth", () => {
  test("detects a trial balance", () => {
    expect(detectStatementKind(TB_GRID)).toBe("trial_balance");
  });

  test("detects a statement (balance sheet)", () => {
    expect(detectStatementKind(BS_GRID)).toBe("statement");
  });

  test("returns null for a non-statement grid", () => {
    expect(detectStatementKind([["Just", "Some"], ["Random", "Data"]])).toBeNull();
  });

  test("synthesizes a clean trial balance (skips title, TOTAL, footer)", () => {
    const t = synthesizeStatement(TB_GRID)!;
    expect(t.columns).toEqual(["account", "debit", "credit"]);
    expect(t.rows).toEqual([
      ["1000 Bank Checking **", "4567.27", ""],
      ["1020 Intercompany:1021 Due from Coreline I Affiliates Fund, LP (CI)", "20797.92", ""],
      ["1090 Accounts Payable", "", "118085.71"],
    ]);
  });

  test("synthesizes a clean statement (account rows only, no sections/totals)", () => {
    const t = synthesizeStatement(BS_GRID)!;
    expect(t.columns).toEqual(["account", "amount"]);
    expect(t.rows).toEqual([
      ["1000 Bank Checking **", "4567.27"],
      ["1001 Citizens Checking - 4279", "250000"],
      ["1090 Accounts Payable", "118085.71"],
    ]);
  });
});
