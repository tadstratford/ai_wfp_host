// Deterministic QBO report recognition — classify a cell map by title + header
// fingerprints. No LLM involved; the LLM schema-mapping path is a separate
// fallback for reports this recognizer cannot name.

import { gridFromCells, normalizeHeader, type CellMap } from "./helpers";

export type QboReportKind =
  | "general_ledger_list"
  | "journal"
  | "chart_of_accounts";

export interface QboRecognition {
  kind: QboReportKind;
  /** Short human label for the confirmation modal. */
  label: string;
}

/** Collect the normalized text of the first `rows` rows (any column). */
function firstRowsText(grid: string[][], rows: number): string {
  const out: string[] = [];
  const limit = Math.min(grid.length, rows);
  for (let r = 0; r < limit; r++) {
    for (const cell of grid[r] ?? []) {
      const t = (cell ?? "").trim();
      if (t) out.push(t.toLowerCase());
    }
  }
  return out.join(" ");
}

/** Title hints that identify a QBO report. Kept broader than `recognizeQboReport`
 *  so the cheap gate never misses a report the recognizer could name. */
const QBO_TITLE_HINTS = [
  "general ledger",
  "journal",
  "chart of accounts",
  "account list",
  "accounts list",
];

/** Cheap pre-filter: does this text plausibly contain a QBO report title?
 *  Scans only the leading slice, so it is safe to run on every upload/paste
 *  before committing to a full cell-map build. */
export function looksLikeQbo(text: string): boolean {
  const head = (text ?? "").slice(0, 2048).toLowerCase();
  return QBO_TITLE_HINTS.some((hint) => head.includes(hint));
}

export function recognizeQboReport(cells: CellMap): QboRecognition | null {
  const grid = gridFromCells(cells);
  const text = firstRowsText(grid, 25);

  // General Ledger / General Ledger List — account-centric, running balance.
  // Accepts either the "Distribution account + Debit/Credit" (List) layout or
  // the "Distribution account + Amount" (General Ledger) layout.
  if (
    text.includes("general ledger") &&
    (text.includes("distribution account") ||
      text.includes("transaction date") ||
      text.includes("transaction type") ||
      text.includes("split") ||
      text.includes("amount"))
  ) {
    return { kind: "general_ledger_list", label: "QuickBooks General Ledger" };
  }

  // Journal — title "journal" (but not "general ledger") + split/debit.
  if (
    /\bjournal\b/.test(text) &&
    !text.includes("general ledger") &&
    (text.includes("split") || text.includes("transaction type")) &&
    (text.includes("debit") || text.includes("credit") || text.includes("amount"))
  ) {
    return { kind: "journal", label: "QuickBooks Journal" };
  }

  // Chart of Accounts / Account List.
  if (
    text.includes("chart of accounts") ||
    text.includes("account list") ||
    text.includes("accounts list")
  ) {
    return { kind: "chart_of_accounts", label: "QuickBooks Chart of Accounts" };
  }

  return null;
}

/** True if the cell map is recognizably a QBO report. */
export function isQboReport(cells: CellMap): boolean {
  return recognizeQboReport(cells) !== null;
}

export { normalizeHeader };
