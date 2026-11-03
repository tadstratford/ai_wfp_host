// Excel (.xlsx) serialization — the write-side counterpart to the read-side
// `xlsx` usage in the data/workspace handlers.
//
// `buildWorkbook` turns an ordered list of named tables into a single .xlsx
// buffer. Kept in wfp-api (next to csv.ts) so both the chat export path and the
// workflow `chat_download` path share one deterministic writer.

import * as XLSX from "xlsx";

export interface WorkbookSheet {
  /** Display name for the sheet (sanitized to Excel's limits). */
  name: string;
  /** Row objects. Columns derive from `columns` or the first row's keys. */
  rows: Record<string, unknown>[];
  /** Optional explicit column order; defaults to the keys of the first row. */
  columns?: string[];
}

/** Excel sheet-name limits: ≤31 chars, no `[]:*?/\\`, can't start/end with `'`. */
const INVALID_SHEET_CHARS = /[\[\]:*?/\\]/g;

export function sanitizeSheetName(name: string): string {
  let out = String(name).replace(INVALID_SHEET_CHARS, "_").replace(/'/g, "");
  if (out.length > 31) out = out.slice(0, 31);
  out = out.trim();
  // Excel disallows empty sheet names and (in some versions) a leading/trailing
  // apostrophe; fall back to a stable placeholder when sanitizing empties it.
  if (out === "") out = "Sheet";
  return out;
}

/** Serialize a row's cell value to something `aoa_to_sheet` can write losslessly. */
function cellValue(v: unknown): string | number | boolean {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Header + body as an array-of-arrays for `XLSX.utils.aoa_to_sheet`. */
export function rowsToAoa(
  rows: Record<string, unknown>[],
  columns?: string[],
): (string | number | boolean)[][] {
  if (rows.length === 0) return columns && columns.length > 0 ? [columns.map(() => "")] : [];
  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  const header = cols.map((c) => cellValue(c));
  const body = rows.map((r) => cols.map((c) => cellValue(r[c])));
  return [header, ...body];
}

/**
 * Build a multi-sheet workbook buffer. Sheet names are sanitized and
 * de-duplicated (a repeated name gets a numeric suffix) so the write never
 * fails on Excel's naming rules.
 */
export function buildWorkbook(sheets: WorkbookSheet[]): Buffer {
  if (sheets.length === 0) {
    throw new Error("buildWorkbook: at least one sheet is required.");
  }
  const wb = XLSX.utils.book_new();
  const seen = new Set<string>();

  for (const sheet of sheets) {
    let name = sanitizeSheetName(sheet.name);
    if (seen.has(name.toLowerCase())) {
      let n = 2;
      let candidate = `${name.slice(0, 29)}_${n}`;
      while (seen.has(candidate.toLowerCase())) {
        n += 1;
        candidate = `${name.slice(0, 29)}_${n}`;
      }
      name = candidate;
    }
    seen.add(name.toLowerCase());

    const aoa = rowsToAoa(sheet.rows, sheet.columns);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  return out;
}

/** Read the sheet names (in order) from a `.xlsx` buffer — used to enumerate
 *  the tabs of an uploaded source workbook. */
export function readSheetNames(buffer: Buffer): string[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames;
}

/** A tabular projection for an inline read-only grid (columns + cell rows). */
export interface GridView {
  columns: string[];
  rows: (string | number | boolean)[][];
  total: number;
}

/** Project row objects into a `columns` + `rows` grid for inline preview. */
export function rowsToGrid(
  rows: Record<string, unknown>[],
  columns?: string[],
): GridView {
  const cols =
    columns && columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : [];
  const grid = rows.map((r) => cols.map((c) => cellValue(r[c])));
  return { columns: cols, rows: grid, total: rows.length };
}
