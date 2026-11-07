import { describe, expect, test } from "bun:test";
import { tieOut, type TieOutSheet } from "./tieOut";

const TB_GRID = [
  ["Coreline Ventures LLC", "", ""],
  ["Trial Balance", "", ""],
  ["As of Sep 30, 2026", "", ""],
  ["", "", ""],
  ["Account Name", "Debit", "Credit"],
  ["1000 Bank Checking **", "4567.27", ""],
  ["1001 Citizens Checking - 4279", "250000", ""],
  ["1055 Due from Employee", "", "0"],
  ["1090 Accounts Payable", "", "118085.71"],
  ["2005 Ramp card", "", "1159.49"],
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
  ["Total Bank Accounts", "254567.27", "", ""],
  ["1055 Due from Employee", "0", "0", "3. Due from EE"],
  ["1090 Accounts Payable", "118085.71", "0", "4. AP Aging"],
  ["2005 Ramp card", "1159.49", "0", "5. Ramp"],
];

function run(bs: TieOutSheet | null = { name: "bs", grid: BS_GRID }) {
  return tieOut({
    trialBalance: { name: "cp_trial_balance", grid: TB_GRID },
    balanceSheet: bs,
  });
}

describe("tieOut", () => {
  test("reconciles every balance-sheet account (assets and liabilities) by code and magnitude", () => {
    const r = run();
    expect(r.accounts.map((a) => [a.code, a.status])).toEqual([
      ["1000", "tie"],
      ["1001", "tie"],
      ["1055", "tie"],
      ["1090", "tie"],
      ["2005", "tie"],
    ]);
    expect(r.summary.accounts).toEqual({ tied: 5, variance: 0, missing_bs: 0, missing_tb: 0 });
  });

  test("flags an account variance when the balance sheet disagrees with the trial balance", () => {
    const bs: TieOutSheet = {
      name: "bs",
      grid: BS_GRID.map((row) => (row[0] === "1000 Bank Checking **" ? [row[0], "5000.00", "0", "1. Cash"] : row)),
    };
    const r = run(bs);
    const acct = r.accounts.find((a) => a.code === "1000")!;
    expect(acct.status).toBe("variance");
    expect(acct.variance).toBe(432.73);
  });

  test("flags missing_tb when a balance-sheet account has no trial-balance balance", () => {
    const bs: TieOutSheet = {
      name: "bs",
      grid: [
        ["", "Total", "Check", "Notes"],
        ["1000 Bank Checking **", "4567.27", "0", "1. Cash"],
        ["9999 Extra BS Account", "10.00", "", ""],
      ],
    };
    const r = run(bs);
    expect(r.accounts.find((a) => a.code === "9999")!.status).toBe("missing_tb");
    expect(r.summary.accounts.missing_tb).toBe(1);
  });

  test("derives schedules from the balance-sheet Notes and ties each", () => {
    const r = run();
    expect(r.schedules.map((s) => [s.schedule, s.status, s.account_codes])).toEqual([
      ["1. Cash", "tie", ["1000", "1001"]],
      ["3. Due from EE", "tie", ["1055"]],
      ["4. AP Aging", "tie", ["1090"]],
      ["5. Ramp", "tie", ["2005"]],
    ]);
    const apAging = r.schedules.find((s) => s.schedule === "4. AP Aging")!;
    expect(apAging.schedule_total).toBe(118085.71);
    expect(apAging.tb_balance).toBe(-118085.71);
    expect(apAging.variance).toBe(0);
    expect(r.summary.schedules).toEqual({ tied: 4, variance: 0, unmatched: 0, unresolved: 0 });
  });

  test("maps a 'Total for X' note to the whole account group (intercompany)", () => {
    const tb: TieOutSheet = {
      name: "tb",
      grid: [
        ["Account Name", "Debit", "Credit"],
        ["1020 Intercompany:1021 Due from CI", "20797.92", ""],
        ["1020 Intercompany:1022 Due from CII", "112468.71", ""],
      ],
    };
    const bs: TieOutSheet = {
      name: "bs",
      grid: [
        ["", "Total", "Notes"],
        ["1021 Due from CI", "20797.92", ""],
        ["1022 Due from CII", "112468.71", ""],
        ["Total for 1020 Intercompany", "133266.63", "2. Intercompany"],
      ],
    };
    const r = tieOut({ trialBalance: tb, balanceSheet: bs });
    const s = r.schedules[0];
    expect(s.schedule).toBe("2. Intercompany");
    expect(s.status).toBe("tie");
    expect(s.account_codes.sort()).toEqual(["1021", "1022"]);
    expect(s.schedule_total).toBe(133266.63);
  });

  test("marks a schedule unresolved when accounts map but no balance-sheet line total exists", () => {
    const tb: TieOutSheet = {
      name: "tb",
      grid: [["Account Name", "Debit", "Credit"], ["1020 Intercompany:1021 Due from CI", "20797.92", ""]],
    };
    const bs: TieOutSheet = {
      name: "bs",
      grid: [["", "Total", "Notes"], ["Total for 1020 Intercompany", "545306.59", "2. Intercompany"]],
    };
    const r = tieOut({ trialBalance: tb, balanceSheet: bs });
    expect(r.schedules[0].status).toBe("unresolved");
    expect(r.schedules[0].account_codes).toEqual(["1021"]);
  });

  test("reports no schedules when the balance sheet has no notes", () => {
    const bs: TieOutSheet = {
      name: "bs",
      grid: [
        ["", "Total"],
        ["1000 Bank Checking **", "4567.27"],
      ],
    };
    const r = run(bs);
    expect(r.schedules).toEqual([]);
    expect(r.summary.schedules.tied).toBe(0);
  });
});
