import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { generateUserDataSummary } from "@backend/core/context/summarize";
import type { DataEntry } from "wfp-format";
import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";
import { buildAutoMask } from "@backend/core/knowledge/autoMask";
import {
  stage,
  rowsToCsv,
  buildCellMap,
  stageLarge,
  countRows,
  LARGE_TABLE_ROW_THRESHOLD,
  MAX_UPLOAD_ROWS,
} from "./stage";
import { synthesize } from "./synth";
import { normalizeData } from "./normalize/vers_1";
import type { NormalizedDataSet } from "./normalize/vers_1";
import { buildDataCatalog, refineDataCatalogWithJev, clearDataCatalog } from "./catalog";
export { saveDataEntry, sanitizeDataName } from "./saveData";

export interface UserDataItem {
  name: string;
  source_filename: string | null;
  loaded_at: string;
  edited_at: string | null;
  size: number; // character count of content
  content_type: string | null;
  row_count: number | null;
  columns: string | null; // JSON array of column names
}

/** Optional typed metadata to store alongside raw content */
export interface UserDataMeta {
  contentJson?: string;      // pre-parsed JSON representation
  contentType?: string;      // csv | json_array | json_object | json_cells | text
  columns?: string | null;   // JSON array of column names
  rowCount?: number | null;  // row count for tabular data
  columnTypes?: string | null; // JSON map of column name → inferred type
  headerRow?: number | null;   // detected header row index
  /** clean header+rows CSV for a single-table result (preamble stripped). */
  normalizedContent?: string;
  /** true when the file was too large to materialize typed rows. */
  large?: boolean;
  /** columns that carry the entry key (forward-filled on continuation lines). */
  keyColumns?: string[] | null;
}

// ---------------------------------------------------------------------------
// Content auto-detection — single source of truth for CSV/JSON parsing
// ---------------------------------------------------------------------------

/** Parse a single CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

/** Parse CSV text into an array of objects */
export function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

/**
 * Auto-detect content type and build metadata from raw content string.
 * Returns UserDataMeta with contentJson, contentType, columns, rowCount,
 * columnTypes, headerRow, and (for a single clean table) normalizedContent.
 * Formatted content with multiple tables becomes `json_cells` (cell-address map).
 */
export function detectContentMeta(content: string): UserDataMeta {
  if (!content || typeof content !== 'string') {
    return { contentType: 'text' };
  }

  const trimmed = content.trim();

  // ── JSON ───────────────────────────────────────────────────────────────────
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const columns = parsed.length > 0 && typeof parsed[0] === 'object' ? Object.keys(parsed[0]) : [];
        return {
          contentJson: JSON.stringify(parsed),
          contentType: 'json_array',
          columns: columns.length > 0 ? JSON.stringify(columns) : null,
          rowCount: parsed.length,
        };
      }
      return {
        contentJson: JSON.stringify(parsed),
        contentType: 'json_object',
      };
    } catch { /* not valid JSON — fall through */ }
  }

  // ── Large tabular content — streaming schema-only staging ─────────────────
  // Files over the row threshold are never materialized into typed rows; we
  // store the raw text once plus schema metadata (no contentJson).
  if (countRows(content) > LARGE_TABLE_ROW_THRESHOLD) {
    const large = stageLarge(content);
    if (large) {
      return {
        contentType: "csv",
        columns: JSON.stringify(large.columns),
        columnTypes: JSON.stringify(large.columnTypes),
        rowCount: large.rowCount,
        headerRow: large.headerIndex,
        normalizedContent: content,
        large: true,
        keyColumns: large.keyColumns,
      };
    }
  }

  // ── Tabular (CSV / sheet) — staged header detection + types ────────────────
  const staged = stage(trimmed);
  if (staged.tables.length > 0) {
    const first = staged.tables[0];
    const columns = JSON.stringify(first.columns);
    const columnTypes = JSON.stringify(first.columnTypes);

    // Multiple tables / formatted report → hold the whole thing as a
    // cell-address map (a1, b5, …) so it can be masked before any LLM use.
    if (staged.multiTable) {
      const cellMap = buildCellMap(trimmed);
      return {
        contentType: 'json_cells',
        contentJson: cellMap ? JSON.stringify(cellMap.cells) : undefined,
        rowCount: cellMap?.rowCount ?? null,
      };
    }

    return {
      contentJson: JSON.stringify(first.rows),
      contentType: 'csv',
      columns,
      rowCount: first.rows.length,
      columnTypes,
      headerRow: first.headerIndex,
      normalizedContent: rowsToCsv(first.columns, first.rawRows),
    };
  }

  // ── Single-column CSV fallback (header without commas) ─────────────────────
  // "date\n2026-04-21" → [{"date":"2026-04-21"}]
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length >= 2 && isLikelyHeader(lines[0])) {
    const header = lines[0].trim();
    const rows = lines.slice(1).map(line => ({ [header]: line.trim() }));
    return {
      contentJson: JSON.stringify(rows),
      contentType: 'csv',
      columns: JSON.stringify([header]),
      rowCount: rows.length,
    };
  }

  // ── Plain text ─────────────────────────────────────────────────────────────
  return { contentType: 'text' };
}

/**
 * Heuristic: does this line look like a CSV header rather than a data value?
 * Headers are typically short, lowercase/mixed-case words with underscores.
 * Data values are typically dates, numbers, sentences, or long strings.
 */
function isLikelyHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  // If it looks like a date (ISO, US, etc.) it's data, not a header
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return false;
  // If it's a number, it's data
  if (/^-?\d[\d,.]*$/.test(t)) return false;
  // If it's a typical identifier/header word (letters, underscores, spaces, no special chars)
  if (/^[a-zA-Z][a-zA-Z0-9_ ]*$/.test(t) && t.length <= 40) return true;
  return false;
}

// ---------------------------------------------------------------------------
// CRUD — backed by the active WorkspaceSession's `data` map (M11e).
// ---------------------------------------------------------------------------

function parseColumns(meta: UserDataMeta): string[] | undefined {
  if (!meta.columns) return undefined;
  try {
    const parsed = JSON.parse(meta.columns);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseContentJson(meta: UserDataMeta): unknown | undefined {
  if (!meta.contentJson) return undefined;
  try {
    return JSON.parse(meta.contentJson);
  } catch {
    return undefined;
  }
}

function parseColumnTypes(meta: UserDataMeta): Record<string, string> | undefined {
  if (!meta.columnTypes) return undefined;
  try {
    const parsed = JSON.parse(meta.columnTypes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

/** Persist a normalized data set as `synth_<parent>_<table>` child entries. */
function writeNormalizedTables(
  session: WorkspaceSession,
  parent: string,
  sourceFilename: string | null,
  ds: NormalizedDataSet,
): string[] {
  const now = new Date().toISOString();
  const names: string[] = [];
  for (const t of ds.tables) {
    const childName = `synth_${parent}_${t.name}`;
    session.setDataEntry(childName, {
      content: JSON.stringify(t.rows),
      content_type: "json_array",
      content_json: t.rows,
      columns: t.columns,
      row_count: t.rows.length,
      column_types: t.columnTypes,
      header_row: 0,
      source_filename: sourceFilename,
      loaded_at: now,
      group: parent,
    });
    names.push(childName);
  }
  return names;
}

export async function loadUserData(
  databaseId: string,
  name: string,
  content: string,
  sourceFilename?: string,
  meta?: UserDataMeta,
): Promise<void> {
  const session = requireSessionByDatabaseId(databaseId);
  const resolved = meta ?? detectContentMeta(content);
  const now = new Date().toISOString();

  if (resolved.rowCount != null && resolved.rowCount > MAX_UPLOAD_ROWS) {
    throw new Error(
      `File has ${resolved.rowCount.toLocaleString()} rows — the maximum is ${MAX_UPLOAD_ROWS.toLocaleString()}. Split it into smaller files.`,
    );
  }

  const existing = session.getDataEntry(name);
  const sourceFile = sourceFilename ?? existing?.source_filename ?? null;

  const entry: DataEntry = {
    content: resolved.normalizedContent ?? content,
    content_type: (resolved.contentType ?? "text") as DataEntry["content_type"],
    content_json: parseContentJson(resolved),
    columns: parseColumns(resolved),
    row_count: resolved.rowCount ?? undefined,
    column_types: parseColumnTypes(resolved),
    header_row: resolved.headerRow ?? undefined,
    source_filename: sourceFile,
    loaded_at: now,
    edited_at: existing ? now : undefined,
    large: resolved.large === true || undefined,
    key_columns: resolved.keyColumns ?? null,
  };

  // Normalize the ORIGINAL raw content into related tables at load time so chat,
  // sessions, and workflow tools never reason about shape. Deterministic (the
  // Jev loop is gated on a configured key); no raw values leave the machine.
  let shapeCandidates: DataEntry["shape_candidates"] = null;
  let normalizedTables: string[] | null = null;
  if (entry.large !== true) {
    try {
      const ds = normalizeData(content);
      if (ds.tables.some((t) => t.name === "accounts")) {
        // Known block-structured shape → capture losslessly + write normalized tables.
        const cm = buildCellMap(content);
        if (cm) {
          if (entry.content_type === "csv") {
            entry.content = JSON.stringify(cm.cells);
            entry.content_type = "json_cells";
            entry.content_json = cm.cells;
            entry.columns = undefined;
            entry.row_count = cm.rowCount;
            entry.column_types = undefined;
            entry.header_row = undefined;
            entry.key_columns = null;
          }
        }
        shapeCandidates = [
          {
            specId: "statement_detail",
            label: "Statement detail (account + transaction lines)",
            confidence: 1,
          },
        ];
        entry.resolved_shape = "statement_detail";
        normalizedTables = writeNormalizedTables(session, name, sourceFile, ds);
      }
    } catch {
      /* normalization is best-effort */
    }
  }
  entry.shape_candidates = shapeCandidates;
  entry.normalized_tables = normalizedTables;

  session.setDataEntry(name, entry);

  // Build the automatic privacy mask before any LLM call sees the data.
  if (entry.content_type === "csv" || entry.content_type === "json_array" || entry.content_type === "json_cells") {
    try {
      buildAutoMask(databaseId, name);
    } catch {
      /* masking is best-effort; never block the upload */
    }
  }

  // Split cell-map reports into clean tables (fire-and-forget) — only when the
  // deterministic normalizer did not already produce normalized tables.
  if (entry.content_type === "json_cells" && !entry.normalized_tables?.length) {
    synthesize(databaseId, name).catch(() => {});
  }

  // Generate summary asynchronously — do not block the upload response
  generateUserDataSummary(databaseId, name, content).catch(() => {});

  // Rebuild the deterministic data catalog (schema + relationships) at load,
  // then refine rename/alias links with Jev in the background.
  try {
    buildDataCatalog(session);
  } catch {
    /* catalog is best-effort; never block the upload */
  }
  refineDataCatalogWithJev(session).catch(() => {});
}

export async function getUserData(
  databaseId: string,
  name: string,
): Promise<string | null> {
  const session = requireSessionByDatabaseId(databaseId);
  const entry = session.getDataEntry(name);
  if (!entry) return null;
  return typeof entry.content === "string" ? entry.content : null;
}

export async function listUserData(databaseId: string): Promise<UserDataItem[]> {
  const session = requireSessionByDatabaseId(databaseId);
  const items: UserDataItem[] = [];
  for (const name of session.getDataNames()) {
    const e = session.getDataEntry(name);
    if (!e) continue;
    const contentStr = typeof e.content === "string" ? e.content : "";
    items.push({
      name,
      source_filename: e.source_filename ?? null,
      loaded_at: e.loaded_at ?? "",
      edited_at: e.edited_at ?? null,
      size: contentStr.length,
      content_type: e.content_type ?? null,
      row_count: e.row_count ?? null,
      columns: e.columns ? JSON.stringify(e.columns) : null,
    });
  }
  items.sort((a, b) => (b.loaded_at ?? "").localeCompare(a.loaded_at ?? ""));
  return items;
}

/** Update content of an existing user data entry, re-detecting metadata */
export async function updateUserData(
  databaseId: string,
  name: string,
  content: string,
): Promise<void> {
  const session = requireSessionByDatabaseId(databaseId);
  const existing = session.getDataEntry(name);
  if (!existing) return;

  const meta = detectContentMeta(content);
  const now = new Date().toISOString();

  session.setDataEntry(name, {
    ...existing,
    content: meta.normalizedContent ?? content,
    content_type: (meta.contentType ?? "text") as DataEntry["content_type"],
    content_json: parseContentJson(meta),
    columns: parseColumns(meta),
    row_count: meta.rowCount ?? undefined,
    column_types: parseColumnTypes(meta),
    header_row: meta.headerRow ?? undefined,
    edited_at: now,
  });

  if (meta.contentType === "json_cells") {
    synthesize(databaseId, name).catch(() => {});
  }

  generateUserDataSummary(databaseId, name, content).catch(() => {});

  try {
    buildDataCatalog(session);
  } catch {
    /* catalog is best-effort */
  }
}

export async function deleteUserData(
  databaseId: string,
  name: string,
): Promise<void> {
  const session = requireSessionByDatabaseId(databaseId);
  session.deleteDataEntry(name);
  // Cascade-delete any synthetic tables derived from this entry.
  for (const n of session.getDataNames()) {
    if (n.startsWith(`synth_${name}_`)) session.deleteDataEntry(n);
  }
  try {
    buildDataCatalog(session);
  } catch {
    /* catalog is best-effort */
  }
}

export async function clearAllUserData(databaseId: string): Promise<void> {
  const session = requireSessionByDatabaseId(databaseId);
  for (const name of session.getDataNames()) {
    session.deleteDataEntry(name);
  }
  clearDataCatalog(session);
}
