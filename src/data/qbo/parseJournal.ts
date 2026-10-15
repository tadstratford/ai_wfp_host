// Deterministic parser: QBO Journal report → QboJournal.
//
// The Journal report is transaction-centric. Header fields (date, type, num,
// name, memo) sit on the first line of each entry and are blank on
// continuation lines; the "Split" account and amounts appear on every line.
// A row with a date opens a new journal entry (header).

import type { QboJournal } from "wfp-format/qbo";
import {
  columnIndex,
  findHeaderRow,
  gridFromCells,
  isDateCell,
  normalizeDate,
  parseCellNumber,
  type CellMap,
} from "./helpers";

export function parseJournal(cells: CellMap, sourceFilename = ""): QboJournal {
  const grid = gridFromCells(cells);
  const headerRow = findHeaderRow(grid);
  if (headerRow < 0) return emptyJournal();

  const cDate = columnIndex(grid, headerRow, "transaction date", "date", "txn date");
  const cType = columnIndex(grid, headerRow, "transaction type", "journal", "type");
  const cNum = columnIndex(grid, headerRow, "num", "no.");
  const cName = columnIndex(grid, headerRow, "name");
  const cMemo = columnIndex(grid, headerRow, "memo/description", "description", "memo");
  const cAccount = columnIndex(grid, headerRow, "split", "account");
  const cDebit = columnIndex(grid, headerRow, "debit");
  const cCredit = columnIndex(grid, headerRow, "credit");

  const headers = {
    date: [] as string[],
    period: [] as string[],
    transactionType: [] as string[],
    num: [] as string[],
    name: [] as string[],
    memo: [] as string[],
    sourceFile: [] as string[],
    source: [] as string[],
  };
  const lines = {
    headerIndex: [] as number[],
    lineNo: [] as number[],
    account: [] as string[],
    accountType: [] as string[],
    debit: [] as number[],
    credit: [] as number[],
    amount: [] as number[],
    memo: [] as string[],
    vendor: [] as string[],
    customer: [] as string[],
    class: [] as string[],
    location: [] as string[],
  };

  let currentHeader = -1;

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const dateRaw = cell(row, cDate);
    const debit = parseCellNumber(cDebit >= 0 ? cell(row, cDebit) : "");
    const credit = parseCellNumber(cCredit >= 0 ? cell(row, cCredit) : "");
    const account = cell(row, cAccount);

    // A row with a date opens a new journal entry (header).
    if (isDateCell(dateRaw)) {
      const date = normalizeDate(dateRaw);
      headers.date.push(date);
      headers.period.push(date.slice(0, 7));
      headers.transactionType.push(cType >= 0 ? cell(row, cType) : "");
      headers.num.push(cNum >= 0 ? cell(row, cNum) : "");
      headers.name.push(cName >= 0 ? cell(row, cName) : "");
      headers.memo.push(cMemo >= 0 ? cell(row, cMemo) : "");
      headers.sourceFile.push(sourceFilename);
      headers.source.push("qbo_journal");
      currentHeader = headers.date.length - 1;
    }

    // Skip rows with no line content (no account and no amount).
    if (!account && debit === 0 && credit === 0) continue;

    lines.headerIndex.push(currentHeader < 0 ? 0 : currentHeader);
    lines.lineNo.push(lines.headerIndex.length);
    lines.account.push(account);
    lines.accountType.push("");
    lines.debit.push(debit);
    lines.credit.push(credit);
    lines.amount.push(debit - credit);
    lines.memo.push(cMemo >= 0 ? cell(row, cMemo) : "");
    lines.vendor.push("");
    lines.customer.push("");
    lines.class.push("");
    lines.location.push("");
  }

  return { schemaVersion: 1, headers, lines };
}

function cell(row: string[] | undefined, col: number): string {
  if (col < 0 || !row) return "";
  return (row[col] ?? "").trim();
}

function emptyJournal(): QboJournal {
  return {
    schemaVersion: 1,
    headers: {
      date: [],
      period: [],
      transactionType: [],
      num: [],
      name: [],
      memo: [],
      sourceFile: [],
      source: [],
    },
    lines: {
      headerIndex: [],
      lineNo: [],
      account: [],
      accountType: [],
      debit: [],
      credit: [],
      amount: [],
      memo: [],
      vendor: [],
      customer: [],
      class: [],
      location: [],
    },
  };
}
