// Deterministic data staging — header detection, type inference, and
// multi-table splitting for tabular content (CSV, or an Excel sheet that was
// converted to CSV). Pure functions, no app imports, so it can be unit-tested
// and reused by both the loader and any read path.

export type InferredType = "number" | "boolean" | "string";

export interface StagedTable {
  /** line index of this table's header row. */
  headerIndex: number;
  /** final column names (trailing empties dropped, empties/dupes renamed). */
  columns: string[];
  /** inferred type per column. */
  columnTypes: Record<string, InferredType>;
  /** typed rows (numbers/booleans cast; blanks become null/""). */
  rows: Record<string, unknown>[];
  /** original row cells (strings, untyped) — used to rebuild child CSV. */
  rawRows: string[][];
}

export interface Staged {
  tables: StagedTable[];
  /** true when more than one table was detected in the content. */
  multiTable: boolean;
}

// ── CSV primitives (quote-aware, embedded-newline safe) ──────────────────────

export function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── Value classification ─────────────────────────────────────────────────────

/** Parse a numeric-ish cell ("$1,234.56", "(3,200.00)", "59.2%", "84"). */
export function parseNumber(s: string): number | null {
  let t = s.trim();
  if (t === "") return null;
  let negative = false;
  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    t = t.slice(1, -1);
  } else if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  }
  t = t.replace(/\$/g, "").replace(/,/g, "").replace(/%/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

function isNumberLike(s: string): boolean {
  return parseNumber(s) !== null;
}

function isDateLike(s: string): boolean {
  const t = s.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(t) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t);
}

function isBooleanLike(s: string): boolean {
  const t = s.toLowerCase().trim();
  return t === "true" || t === "false";
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

function nonEmptyCount(cells: string[]): number {
  return cells.filter((c) => c.trim() !== "").length;
}

/** A totals/label row like "Total,142,," or "Total for 06/30/2025,…" that
 *  shouldn't be treated as data. Matches the common report subtotal prefixes. */
export function isTotalsRow(cells: string[]): boolean {
  const first = (cells.find((c) => c.trim() !== "") ?? "").trim().toLowerCase();
  if (!first) return false;
  return /^(total|subtotal|grand total|net total|totals)(\b|$)/.test(first);
}

/** A plausible header row: ≥2 non-empty cells, at least one of which is not
 *  numeric/date/boolean (so "84,59.2%,36" is not mistaken for a header). */
export function isHeaderLike(cells: string[]): boolean {
  const nonEmpty = cells.filter((c) => c.trim() !== "");
  if (nonEmpty.length < 2) return false;
  return nonEmpty.some((c) => {
    const t = c.trim();
    return !isNumberLike(t) && !isDateLike(t) && !isBooleanLike(t);
  });
}

function prevNonBlankIndex(lines: string[][], from: number): number {
  for (let i = from - 1; i >= 0; i--) {
    if (!isBlankRow(lines[i])) return i;
  }
  return -1;
}

// ── Column naming ────────────────────────────────────────────────────────────

function buildColumns(headerCells: string[]): string[] {
  let cells = headerCells.map((c) => c.trim());
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end--;
  cells = cells.slice(0, end);

  const seen = new Map<string, number>();
  return cells.map((c, i) => {
    let name = c === "" ? `col_${i + 1}` : c;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name}_${count + 1}`;
    return name;
  });
}

// ── Type inference + casting ─────────────────────────────────────────────────

function inferColumnType(values: string[]): InferredType {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== "");
  if (nonEmpty.length === 0) return "string";
  if (nonEmpty.every(isBooleanLike)) return "boolean";
  if (nonEmpty.every(isNumberLike)) return "number";
  return "string";
}

function castValue(v: string, type: InferredType): unknown {
  const t = v.trim();
  if (type === "number") {
    const n = parseNumber(t);
    return n === null ? null : n;
  }
  if (type === "boolean") {
    const b = t.toLowerCase();
    if (b === "true") return true;
    if (b === "false") return false;
    return null;
  }
  return t;
}

// ── Table construction ───────────────────────────────────────────────────────

export function buildTable(
  headerCells: string[],
  rawRows: string[][],
  headerIndex: number,
): StagedTable {
  const columns = buildColumns(headerCells);

  // Infer types column-wise from the raw string rows.
  const columnTypes: Record<string, InferredType> = {};
  for (let c = 0; c < columns.length; c++) {
    const values = rawRows.map((r) => r[c] ?? "");
    columnTypes[columns[c]] = inferColumnType(values);
  }

  const rows = rawRows.map((r) => {
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = castValue(r[c] ?? "", columnTypes[columns[c]]);
    }
    return obj;
  });

  return {
    headerIndex,
    columns,
    columnTypes,
    rows,
    rawRows,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/** Stage a tabular content string into one or more clean tables. */
export function stage(content: string): Staged {
  const lines = splitCsvLines(content).map(parseCsvLine);
  if (lines.length < 2) return { tables: [], multiTable: false };

  // Locate the first header row (skip preamble title/note/blank rows).
  let firstHeader = -1;
  const scan = Math.min(lines.length, 25);
  for (let i = 0; i < scan; i++) {
    if (isHeaderLike(lines[i])) {
      firstHeader = i;
      break;
    }
  }
  if (firstHeader === -1) return { tables: [], multiTable: false };

  const boundaries: { headerIndex: number; title: string | null }[] = [];
  const firstTitleIdx = prevNonBlankIndex(lines, firstHeader);
  const firstTitle =
    firstTitleIdx >= 0 && nonEmptyCount(lines[firstTitleIdx]) === 1
      ? lines[firstTitleIdx].find((c) => c.trim() !== "")?.trim() ?? null
      : null;
  boundaries.push({ headerIndex: firstHeader, title: firstTitle });

  // Detect subsequent tables: a header-like row immediately preceded by a
  // single-cell title row (a common "stacked tables on one sheet" pattern).
  for (let i = firstHeader + 1; i < lines.length; i++) {
    if (!isHeaderLike(lines[i])) continue;
    const prev = prevNonBlankIndex(lines, i);
    if (prev < 0 || nonEmptyCount(lines[prev]) !== 1) continue;
    const title = lines[prev].find((c) => c.trim() !== "")?.trim() ?? null;
    boundaries.push({ headerIndex: i, title });
  }

  const tables: StagedTable[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].headerIndex;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].headerIndex : lines.length;
    const rawRows: string[][] = [];
    for (let i = start + 1; i < end; i++) {
      if (isBlankRow(lines[i])) continue;
      // Skip section titles / notes (single-cell) and totals rows — these are
      // layout scaffolding, not data.
      if (nonEmptyCount(lines[i]) === 1) continue;
      if (isTotalsRow(lines[i])) continue;
      rawRows.push(lines[i]);
    }
    tables.push(buildTable(lines[start], rawRows, start));
  }

  return { tables, multiTable: tables.length > 1 };
}

/** Serialize column headers + raw rows back to a CSV string (for child objects). */
export function rowsToCsv(columns: string[], rawRows: string[][]): string {
  const escape = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = columns.map(escape).join(",");
  const dataLines = rawRows.map((r) =>
    columns.map((_, c) => escape(r[c] ?? "")).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

// ── Cell-address map (json_cells) ────────────────────────────────────────────

/** 0-based column index → spreadsheet column letters (0 → "a", 26 → "aa"). */
export function colIndexToLetters(idx: number): string {
  let n = idx;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 97) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Map a parsed 2D grid to `{ "a1": value, "b5": value, … }`, skipping empty
 *  cells. Values are trimmed strings. Used for formatted reports that can't be
 *  represented as a single clean table. */
export function gridToCellMap(grid: string[][]): {
  cells: Record<string, string>;
  rowCount: number;
  colCount: number;
} {
  const cells: Record<string, string> = {};
  let colCount = 0;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.length > colCount) colCount = row.length;
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] ?? "").trim();
      if (v === "") continue;
      cells[`${colIndexToLetters(c)}${r + 1}`] = v;
    }
  }
  return { cells, rowCount: grid.length, colCount };
}

/** Split CSV content into a cell-address map (synthetic addresses from row/col). */
export function buildCellMap(content: string): {
  cells: Record<string, string>;
  rowCount: number;
  colCount: number;
} | null {
  if (!content) return null;
  const grid = splitCsvLines(content).map(parseCsvLine);
  if (grid.length === 0) return null;
  return gridToCellMap(grid);
}

// ── Cell-map synthesis (json_cells → clean tables) ───────────────────────────

/** Spreadsheet column letters → 0-based index ("a" → 0, "aa" → 26). */
function lettersToColIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 97 + 1);
  }
  return n - 1;
}

/** Rebuild a dense 2D grid from a cell-address map ({ "a1": value, … }). */
export function cellMapToGrid(cells: Record<string, string>): string[][] {
  const parsed: { r: number; c: number; v: string }[] = [];
  let maxR = 0;
  let maxC = 0;
  for (const [addr, v] of Object.entries(cells)) {
    const m = /^([a-z]+)(\d+)$/.exec(addr);
    if (!m) continue;
    const c = lettersToColIndex(m[1]);
    const r = parseInt(m[2], 10) - 1;
    if (r < 0 || c < 0) continue;
    parsed.push({ r, c, v });
    if (r + 1 > maxR) maxR = r + 1;
    if (c + 1 > maxC) maxC = c + 1;
  }
  const grid: string[][] = Array.from({ length: maxR }, () =>
    Array<string>(maxC).fill(""),
  );
  for (const p of parsed) grid[p.r][p.c] = p.v;
  return grid;
}

/** Serialize a grid to CSV text (cells containing commas/quotes are escaped). */
export function gridToCsv(grid: string[][]): string {
  const escape = (s: string) => {
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return grid.map((row) => row.map((c) => escape(c ?? "")).join(",")).join("\n");
}

/** Slugify a string into a URL/name-safe identifier (empty → null). */
export function slugify(s: string): string | null {
  let t = s.toLowerCase();
  t = t.replace(/\(.*?\)/g, " ");
  t = t.replace(/[—–-]/g, " ");
  t = t.replace(/[^a-z0-9]+/g, "_");
  t = t.replace(/^_+|_+$/g, "");
  t = t.replace(/_+/g, "_");
  t = t.slice(0, 48).replace(/_+$/g, "");
  return t || null;
}

/** Find a table's title: the nearest preceding single-cell row above the header. */
export function cellGridTitle(grid: string[][], headerRow: number): string | null {
  for (let i = headerRow - 1; i >= 0; i--) {
    const nonEmpty = (grid[i] ?? []).filter((c) => c.trim() !== "");
    if (nonEmpty.length === 0) continue;
    return nonEmpty.length === 1 ? nonEmpty[0].trim() : null;
  }
  return null;
}

// ── Large / streaming table access ──────────────────────────────────────────
//
// Large files are never fully materialized into typed rows. `stageLarge` builds
// schema + key-column metadata in one bounded pass; `scanDataRows` streams data
// rows on demand (paging / aggregation) with report-row skipping and journal
// continuation forward-fill applied deterministically.

/** Row count threshold above which a tabular file is treated as "large". */
export const LARGE_TABLE_ROW_THRESHOLD = 1000;
/** Hard safety cap — reject uploads beyond this many rows with a friendly error. */
export const MAX_UPLOAD_ROWS = 200_000;

/** Quote-aware row count without materializing line strings. */
export function countRows(text: string): number {
  if (!text) return 0;
  let rows = 0;
  let inQuotes = false;
  let lastBreak = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rows++;
      lastBreak = i;
    }
  }
  if (lastBreak < text.length - 1) rows++;
  return rows;
}

/** True when a parsed row is report scaffolding (blank / title / totals) that
 *  should be excluded from data rows. Shared by ingest and the read paths. */
export function isSkippedDataRow(cells: string[]): boolean {
  if (isBlankRow(cells)) return true;
  if (nonEmptyCount(cells) === 1) return true;
  if (isTotalsRow(cells)) return true;
  return false;
}

/** Schema + metadata for a large tabular file, computed in one bounded pass. */
export interface StagedLarge {
  /** final column names (trailing empties dropped, empties/dupes renamed). */
  columns: string[];
  /** inferred type per column ("number" | "boolean" | "string"). */
  columnTypes: Record<string, string>;
  /** number of data rows (report scaffolding excluded, continuations included). */
  rowCount: number;
  /** 0-based line index of the header row. */
  headerIndex: number;
  /** columns that carry the entry key (forward-filled on continuation lines). */
  keyColumns: string[];
}

/**
 * Stage a large tabular content string without materializing all rows as typed
 * objects. Finds the header, infers column types from a bounded sample, counts
 * data rows, and identifies key columns (sparse leading string columns that get
 * blanked on journal-style continuation lines).
 */
export function stageLarge(content: string, sampleSize = 500): StagedLarge | null {
  const lines = splitCsvLines(content).map(parseCsvLine);
  if (lines.length < 2) return null;

  let firstHeader = -1;
  const scan = Math.min(lines.length, 25);
  for (let i = 0; i < scan; i++) {
    if (isHeaderLike(lines[i])) {
      firstHeader = i;
      break;
    }
  }
  if (firstHeader === -1) return null;

  const headerCells = lines[firstHeader];
  const columns = buildColumns(headerCells);

  // Sample of data rows for type inference + key-column detection.
  const dataRows: string[][] = [];
  for (let i = firstHeader + 1; i < lines.length && dataRows.length < sampleSize; i++) {
    if (isSkippedDataRow(lines[i])) continue;
    dataRows.push(lines[i]);
  }
  if (dataRows.length === 0) return null;

  const columnTypes: Record<string, string> = {};
  for (let c = 0; c < columns.length; c++) {
    const values = dataRows.map((r) => r[c] ?? "");
    columnTypes[columns[c]] = inferColumnType(values);
  }

  // Count all data rows.
  let rowCount = 0;
  for (let i = firstHeader + 1; i < lines.length; i++) {
    if (isSkippedDataRow(lines[i])) continue;
    rowCount++;
  }

  // Key columns: non-numeric/boolean columns that are frequently blank (i.e.
  // journal continuation lines leave them empty), sorted in header order.
  const keyColumns: string[] = [];
  for (let c = 0; c < columns.length; c++) {
    const type = columnTypes[columns[c]];
    if (type === "number" || type === "boolean") continue;
    const blank = dataRows.filter((r) => (r[c] ?? "").trim() === "").length;
    if (blank / dataRows.length > 0.1) keyColumns.push(columns[c]);
  }

  return { columns, columnTypes, rowCount, headerIndex: firstHeader, keyColumns };
}

export interface ScanOptions {
  headerIndex: number;
  keyColumns?: string[];
}

/**
 * Stream data rows from a large tabular content string, applying report-row
 * skipping and journal continuation forward-fill. `onRow` receives each data
 * row (cells, 0-based data index); return `false` to stop early. Returns the
 * number of data rows visited.
 */
export function scanDataRows(
  content: string,
  opts: ScanOptions,
  onRow: (cells: string[], dataIndex: number) => void | false,
): number {
  const lines = splitCsvLines(content);
  const headerIndex = opts.headerIndex;
  const keyCols = opts.keyColumns ?? [];

  const headerCells =
    headerIndex >= 0 && headerIndex < lines.length ? parseCsvLine(lines[headerIndex]) : [];
  const nameToIndex = new Map<string, number>();
  headerCells.forEach((h, i) => nameToIndex.set(h.trim(), i));
  const keyIndices = keyCols
    .map((name) => nameToIndex.get(name) ?? -1)
    .filter((i) => i >= 0);
  const firstKey = keyIndices.length > 0 ? keyIndices[0] : -1;

  const lastKey: string[] = new Array(keyIndices.length).fill("");
  let dataIndex = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (isSkippedDataRow(cells)) continue;

    const isContinuation = firstKey >= 0 && (cells[firstKey] ?? "").trim() === "";
    if (isContinuation) {
      for (let k = 0; k < keyIndices.length; k++) {
        if ((cells[keyIndices[k]] ?? "").trim() === "") cells[keyIndices[k]] = lastKey[k];
      }
    } else {
      for (let k = 0; k < keyIndices.length; k++) {
        lastKey[k] = cells[keyIndices[k]] ?? "";
      }
    }

    const stop = onRow(cells, dataIndex);
    dataIndex++;
    if (stop === false) break;
  }

  return dataIndex;
}

/** Read a single page of data rows (with skipping + forward-fill applied). */
export function readCsvPage(
  content: string,
  opts: { headerIndex: number; keyColumns?: string[]; offset: number; limit: number },
): { rows: string[][]; count: number } {
  const rows: string[][] = [];
  scanDataRows(
    content,
    { headerIndex: opts.headerIndex, keyColumns: opts.keyColumns },
    (cells, dataIndex) => {
      if (dataIndex < opts.offset) return;
      if (rows.length < opts.limit) rows.push(cells);
      if (rows.length >= opts.limit) return false;
    },
  );
  return { rows, count: rows.length };
}
