// Shared helpers for QBO report recognition and parsing.
//
// All functions are pure and operate on a cell-address map (the `json_cells`
// representation the upload pipeline already produces for formatted reports)
// or on a dense grid rebuilt from that map.

import { cellMapToGrid, parseNumber } from "../stage";

export type CellMap = Record<string, string>;

/** Column header aliases — a header cell matching any alias maps to that role. */
export const COLUMN_ALIASES: Record<string, string[]> = {
  account: ["distribution account", "account", "split", "account name"],
  date: ["transaction date", "date", "txn date"],
  description: ["description", "memo/description", "memo", "memo/desc"],
  name: ["name"],
  txnId: ["transaction id", "txn id", "transaction", "id"],
  num: ["num", "no.", "number", "doc no", "doc #"],
  balance: ["balance"],
  debit: ["debit"],
  credit: ["credit"],
  amount: ["amount"],
  type: ["transaction type", "journal", "type"],
  accountNumber: ["account number", "account #", "acct #", "number"],
  subType: ["detail type", "subtype", "sub type", "detail"],
};

export function normalizeHeader(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Rebuild a dense grid from a cell map ({ "a1": v, … }). */
export function gridFromCells(cells: CellMap): string[][] {
  return cellMapToGrid(cells);
}

/** Index of the first row that looks like a column header. */
export function findHeaderRow(grid: string[][], maxScan = 25): number {
  const terms = [
    "debit",
    "credit",
    "transaction date",
    "txn date",
    "transaction type",
    "distribution account",
    "account type",
    "detail type",
    "balance",
    "amount",
    "split",
    "memo/description",
    "memo/desc",
  ];
  const limit = Math.min(grid.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const norm = (grid[r] ?? []).map(normalizeHeader);
    if (norm.some((t) => terms.includes(t))) return r;
  }
  return -1;
}

/** Column index whose header matches one of the given aliases, or -1. */
export function columnIndex(
  grid: string[][],
  headerRow: number,
  ...aliases: string[]
): number {
  const row = grid[headerRow] ?? [];
  const set = new Set(aliases.map(normalizeHeader));
  for (let c = 0; c < row.length; c++) {
    if (set.has(normalizeHeader(row[c]))) return c;
  }
  return -1;
}

/** Parse a numeric cell ("$1,234.56", "(3.20)", "59.2%", "" → 0). */
export function parseCellNumber(value: string): number {
  const n = parseNumber(value);
  return n ?? 0;
}

const DATE_RE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/;

export function isDateCell(value: string): boolean {
  const t = (value ?? "").trim();
  return DATE_RE.test(t);
}

/** Normalize a US-format date cell to 'YYYY-MM-DD'. Returns "" if not a date. */
export function normalizeDate(value: string): string {
  const t = (value ?? "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  return "";
}

/** Join an ancestor path into a unique account key. */
export function accountKey(ancestors: string[], leaf: string): string {
  return ancestors.length ? `${ancestors.join(":")}:${leaf}` : leaf;
}
