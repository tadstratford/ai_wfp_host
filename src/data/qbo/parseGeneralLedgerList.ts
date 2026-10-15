// Deterministic parser: QBO General Ledger List report → QboGeneralLedgerList.
//
// The GL report is account-centric: each account is a section (title in column
// A), followed by an optional "Beginning Balance" row, its transaction lines
// (column B = account, C = date, …), and a "Total for X" row. Parent accounts
// are detected from their "Total for X with sub-accounts" rollup rows.

import type { QboGeneralLedgerList } from "wfp-format/qbo";
import {
  accountKey,
  COLUMN_ALIASES,
  columnIndex,
  findHeaderRow,
  gridFromCells,
  isDateCell,
  normalizeDate,
  parseCellNumber,
  type CellMap,
} from "./helpers";

const TOTAL_RE = /^total for (.+?)( with sub-accounts)?$/i;

export function parseGeneralLedgerList(
  cells: CellMap,
  sourceFilename = "",
): QboGeneralLedgerList {
  const grid = gridFromCells(cells);
  const headerRow = findHeaderRow(grid);
  if (headerRow < 0) return emptyGl();

  // Column resolution goes through the shared alias table so users can rename
  // or drop columns without breaking the parse. "Split" is deliberately NOT an
  // account alias here: in the QBO "General Ledger" layout it is the offsetting
  // account, not the account being detailed.
  const cAccount = columnIndex(grid, headerRow, "distribution account", "account", "account name");
  const cDate = columnIndex(grid, headerRow, ...COLUMN_ALIASES.date);
  const cDescription = columnIndex(grid, headerRow, ...COLUMN_ALIASES.description);
  const cName = columnIndex(grid, headerRow, ...COLUMN_ALIASES.name);
  const cTxnId = columnIndex(grid, headerRow, ...COLUMN_ALIASES.txnId);
  const cNum = columnIndex(grid, headerRow, ...COLUMN_ALIASES.num);
  const cBalance = columnIndex(grid, headerRow, ...COLUMN_ALIASES.balance);
  const cDebit = columnIndex(grid, headerRow, ...COLUMN_ALIASES.debit);
  const cCredit = columnIndex(grid, headerRow, ...COLUMN_ALIASES.credit);
  const cAmount = columnIndex(grid, headerRow, ...COLUMN_ALIASES.amount);

  // Pass A — collect parent account names from "Total for X with sub-accounts".
  const parentNames = new Set<string>();
  for (let r = headerRow + 1; r < grid.length; r++) {
    const a = cell(grid[r], 0);
    const m = TOTAL_RE.exec(a);
    if (m && m[2]) parentNames.add(m[1].trim());
  }

  // Pass B — walk rows, build accounts + lines.
  const accounts = {
    name: [] as string[],
    parent: [] as (string | null)[],
    accountType: [] as string[],
    openingBalance: [] as number[],
  };
  const lines = {
    accountIndex: [] as number[],
    date: [] as string[],
    period: [] as string[],
    description: [] as string[],
    name: [] as string[],
    txnId: [] as string[],
    num: [] as string[],
    debit: [] as number[],
    credit: [] as number[],
    amount: [] as number[],
    sourceFile: [] as string[],
    source: [] as string[],
  };

  const accountIndexByKey = new Map<string, number>();
  const stack: string[] = [];
  let currentDataKey = "";

  function registerAccount(leaf: string): number {
    const parent = stack.length ? stack[stack.length - 1] : null;
    const key = accountKey(stack, leaf);
    const existing = accountIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const idx = accounts.name.length;
    accounts.name.push(leaf);
    accounts.parent.push(parent);
    accounts.accountType.push("");
    accounts.openingBalance.push(0);
    accountIndexByKey.set(key, idx);
    return idx;
  }

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const a = cell(row, 0);
    const b = cell(row, cAccount);
    const dateRaw = cell(row, cDate);

    // "Total for X" rows — pop the parent on a "with sub-accounts" rollup.
    if (a) {
      const m = TOTAL_RE.exec(a);
      if (m) {
        if (m[2] && stack.length && stack[stack.length - 1] === m[1].trim()) {
          stack.pop();
        }
        continue;
      }
    }

    // Report footer ("Accrual/Cash Basis … date time") — not an account.
    if (a && /^(accrual|cash)\s+basis\b/i.test(a)) continue;

    // "Beginning Balance" row (no date) — the account's carry-in balance. The
    // label can sit in any column depending on layout (QBO puts it where the
    // account/date column falls), so match on any cell equal to the label.
    if (
      !isDateCell(dateRaw) &&
      row.some((c) => (c ?? "").trim().toLowerCase() === "beginning balance")
    ) {
      const bal = parseCellNumber(cBalance >= 0 ? cell(row, cBalance) : "");
      const idx = accountIndexByKey.get(currentDataKey);
      if (idx !== undefined) accounts.openingBalance[idx] += bal;
      continue;
    }

    // Section title (column A, not a total) — an account.
    if (a && !isDateCell(dateRaw)) {
      currentDataKey = accountKey(stack, a);
      registerAccount(a);
      if (parentNames.has(a)) stack.push(a);
      continue;
    }

    // Data line — the date column carries a date.
    if (isDateCell(dateRaw)) {
      // Account resolution: the current section account wins (set by the most
      // recent section-title row). When there is none (flat layout), fall back
      // to the account column, then to column A when it holds an account name
      // rather than a date. This lets the QBO layout — which puts the account
      // only on the section header and leaves it blank on detail rows — parse
      // fully instead of dropping every detail row.
      let idx = accountIndexByKey.get(currentDataKey);
      if (idx === undefined) {
        const aIsAccount = a && !isDateCell(a);
        const leaf = b || (aIsAccount ? a : "");
        if (!leaf) continue; // system row with no identifiable account
        idx = registerAccount(leaf);
        if (currentDataKey) accountIndexByKey.set(currentDataKey, idx);
      }
      let debit: number;
      let credit: number;
      if (cDebit >= 0 && cCredit >= 0) {
        debit = parseCellNumber(cell(row, cDebit));
        credit = parseCellNumber(cell(row, cCredit));
      } else if (cAmount >= 0) {
        const v = parseCellNumber(cell(row, cAmount));
        debit = v > 0 ? v : 0;
        credit = v < 0 ? -v : 0;
      } else {
        debit = 0;
        credit = 0;
      }
      const date = normalizeDate(dateRaw);
      lines.accountIndex.push(idx);
      lines.date.push(date);
      lines.period.push(date.slice(0, 7));
      lines.description.push(cDescription >= 0 ? cell(row, cDescription) : "");
      lines.name.push(cName >= 0 ? cell(row, cName) : "");
      lines.txnId.push(cTxnId >= 0 ? cell(row, cTxnId) : "");
      lines.num.push(cNum >= 0 ? cell(row, cNum) : "");
      lines.debit.push(debit);
      lines.credit.push(credit);
      lines.amount.push(debit - credit);
      lines.sourceFile.push(sourceFilename);
      lines.source.push("qbo_gl");
    }
  }

  return { schemaVersion: 1, accounts, lines };
}

function cell(row: string[] | undefined, col: number): string {
  if (col < 0 || !row) return "";
  return (row[col] ?? "").trim();
}

function emptyGl(): QboGeneralLedgerList {
  return {
    schemaVersion: 1,
    accounts: { name: [], parent: [], accountType: [], openingBalance: [] },
    lines: {
      accountIndex: [],
      date: [],
      period: [],
      description: [],
      name: [],
      txnId: [],
      num: [],
      debit: [],
      credit: [],
      amount: [],
      sourceFile: [],
      source: [],
    },
  };
}
