import { describe, expect, test } from "bun:test";
import { detectTrialBalance, scheduleTables, isTieOutRequest, type ReviewEntry } from "./cascade";

function entry(name: string, columns: string[], types: Record<string, string> | null, rowCount = 1): ReviewEntry {
  return { name, columns, columnTypes: types, rowCount };
}

describe("tie-out shape detection", () => {
  const inventory: ReviewEntry[] = [
    entry("synth_cp_trial_balance_as_of_sep_30_2026", ["Account Name", "Debit", "Credit"], {
      "Account Name": "text", Debit: "currency", Credit: "currency",
    }, 50),
    entry("synth_cp_balance_sheet_bank_accounts", ["1000 Bank Checking **", "4567.27"], {
      "1000 Bank Checking **": "text", "4567.27": "currency",
    }, 3),
    entry("synth_cp_balance_sheet_equity", ["3000 Contributed Capital", "1000000"], {
      "3000 Contributed Capital": "text", "1000000": "currency",
    }, 3),
    entry("staging_summary", ["Account", "Amount"], { Account: "text", Amount: "currency" }, 1),
  ];

  test("identifies the trial balance by name", () => {
    const tb = detectTrialBalance(inventory);
    expect(tb?.name).toBe("synth_cp_trial_balance_as_of_sep_30_2026");
  });

  test("identifies the trial balance by dual debit/credit columns when the name is opaque", () => {
    const renamed = [
      entry("ledger", ["GL Account", "Dr", "Cr"], { "GL Account": "text", Dr: "currency", Cr: "currency" }, 10),
      entry("some_schedule", ["Account", "Amount"], { Account: "text", Amount: "currency" }, 2),
    ];
    const tb = detectTrialBalance(renamed);
    expect(tb?.name).toBe("ledger");
  });

  test("returns null when no trial balance is identifiable", () => {
    const noTb = [entry("a", ["Account", "Amount"], { Account: "text", Amount: "currency" }, 2)];
    expect(detectTrialBalance(noTb)).toBeNull();
  });

  test("scheduleTables excludes the trial balance, staging, and empty tables", () => {
    const schedules = scheduleTables(inventory, "synth_cp_trial_balance_as_of_sep_30_2026");
    expect(schedules.map((s) => s.name).sort()).toEqual([
      "synth_cp_balance_sheet_bank_accounts",
      "synth_cp_balance_sheet_equity",
    ]);
  });
});

describe("isTieOutRequest", () => {
  test("detects the reported tie-out phrasing", () => {
    expect(isTieOutRequest("can you check if the supporting schedules tie to the trial balance")).toBe(true);
  });

  test("detects reconcile-to-trial-balance phrasing", () => {
    expect(isTieOutRequest("do the schedules reconcile to the trial balance")).toBe(true);
  });

  test("rejects a plain reconcile without a trial-balance/schedule target", () => {
    expect(isTieOutRequest("reconcile the bank account")).toBe(false);
  });

  test("rejects a generic review", () => {
    expect(isTieOutRequest("review the data for errors")).toBe(false);
  });
});
