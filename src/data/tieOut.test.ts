import { describe, expect, test } from "bun:test";
import { tieOut, type TieOutTable } from "./tieOut";

const TB: TieOutTable = {
  name: "trial_balance",
  columns: ["Account Name", "Debit", "Credit"],
  columnTypes: { "Account Name": "text", Debit: "currency", Credit: "currency" },
  rows: [
    { "Account Name": "1000 Bank Checking", Debit: "4567.27", Credit: "" },
    { "Account Name": "1020 Intercompany Receivable", Debit: "20797.92", Credit: "" },
    { "Account Name": "2009 Intercompany Payable", Debit: "", Credit: "2444581.56" },
  ],
};

function schedule(name: string, rows: Record<string, unknown>[], amountType = "currency"): TieOutTable {
  const columns = ["Account", "Amount"];
  return {
    name,
    columns,
    columnTypes: { Account: "text", Amount: amountType },
    rows: rows.map((r) => ({ Account: r.Account, Amount: r.Amount })),
  };
}

describe("tieOut", () => {
  test("ties a schedule to its account by name token (bank)", () => {
    const s = schedule("balance_sheet_bank_accounts", [{ Account: "1000 Bank Checking", Amount: "4567.27" }]);
    const r = tieOut(TB, [s]);
    expect(r.schedules[0]).toMatchObject({
      status: "tie",
      schedule_total: 4567.27,
      tb_balance: 4567.27,
      variance: 0,
    });
    expect(r.schedules[0].tb_accounts).toEqual(["1000 Bank Checking"]);
    expect(r.summary.tied).toBe(1);
  });

  test("ties a schedule to its account by account code", () => {
    const s = schedule("balance_sheet_1020_intercompany", [{ Account: "1020 Intercompany Receivable", Amount: "20797.92" }]);
    const r = tieOut(TB, [s]);
    expect(r.schedules[0].status).toBe("tie");
    expect(r.schedules[0].tb_accounts).toEqual(["1020 Intercompany Receivable"]);
  });

  test("flags a variance when the schedule total disagrees with the account balance", () => {
    const s = schedule("balance_sheet_bank_accounts", [{ Account: "1000 Bank Checking", Amount: "5000.00" }]);
    const r = tieOut(TB, [s]);
    expect(r.schedules[0].status).toBe("variance");
    expect(r.schedules[0].variance).toBe(432.73);
    expect(r.summary.variance).toBe(1);
  });

  test("ties a credit (liability) schedule via its account-column value", () => {
    const s = schedule("balance_sheet_other_current_liabilities", [
      { Account: "2009 Intercompany Payable", Amount: "-2444581.56" },
    ]);
    const r = tieOut(TB, [s]);
    expect(r.schedules[0].status).toBe("tie");
    expect(r.schedules[0].tb_balance).toBe(-2444581.56);
    expect(r.schedules[0].tb_accounts).toEqual(["2009 Intercompany Payable"]);
  });

  test("marks a schedule unmatched when no account code or name token matches", () => {
    const s = schedule("balance_sheet_9999_misc", [{ Account: "9999 Mystery", Amount: "123.45" }]);
    const r = tieOut(TB, [s]);
    expect(r.schedules[0].status).toBe("unmatched");
    expect(r.schedules[0].tb_accounts).toEqual([]);
    expect(r.summary.unmatched).toBe(1);
  });

  test("marks a transposed schedule unresolved (bare-number amount column) rather than summing garbage", () => {
    const s: TieOutTable = {
      name: "balance_sheet_bank_accounts",
      columns: ["1000 Bank Checking **", "4567.27"],
      columnTypes: { "1000 Bank Checking **": "text", "4567.27": "currency" },
      rows: [
        { "1000 Bank Checking **": "1001 Citizens Checking - 4279", "4567.27": "250000" },
        { "1000 Bank Checking **": "1002 Citizens Sweep - 4295", "4567.27": "420127.2" },
      ],
    };
    const r = tieOut(TB, [s]);
    expect(r.schedules[0].status).toBe("unresolved");
    expect(r.schedules[0].schedule_total).toBeNull();
    expect(r.summary.unresolved).toBe(1);
  });

  test("reports the trial balance account column", () => {
    const s = schedule("balance_sheet_bank_accounts", [{ Account: "1000 Bank Checking", Amount: "4567.27" }]);
    const r = tieOut(TB, [s]);
    expect(r.account_column).toBe("Account Name");
    expect(r.trial_balance).toBe("trial_balance");
  });
});
