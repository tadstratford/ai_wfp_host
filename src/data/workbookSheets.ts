// Workbook sheet resolution — enumerate the workspace's tabular data entries and
// resolve a selection of them into full `WorkbookSheet`s (row objects + columns).
//
// Shared by the `export_workbook` MCP tool and the standalone workbook builder
// page, so both paths agree on which entries are "tabular" and how their rows
// are materialized.

import { extractTable } from "./table";
import { rowsToGrid, type GridView, type WorkbookSheet } from "@shared/wfp-api/xlsx";
import type { DataEntry } from "wfp-format";

/** The slice of WorkspaceSession the resolver needs (kept minimal for tests). */
export interface DataSessionLike {
  getDataNames(): string[];
  getDataEntry(name: string): DataEntry | null;
}

export interface TabularEntrySummary {
  name: string;
  columns: string[];
  rowCount: number;
}

const TABULAR_TYPES = new Set(["csv", "json_array"]);

/** Tabular (csv/json_array) data entries, alphabetized for a stable checklist. */
export function listTabularEntries(ws: DataSessionLike): TabularEntrySummary[] {
  const out: TabularEntrySummary[] = [];
  for (const name of ws.getDataNames()) {
    const e = ws.getDataEntry(name);
    if (!e || !TABULAR_TYPES.has(e.content_type ?? "")) continue;
    out.push({
      name,
      columns: Array.isArray(e.columns) ? (e.columns as string[]) : [],
      rowCount: typeof e.row_count === "number" ? e.row_count : 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve the named tabular entries into full sheets (row objects + columns).
 *  Names that are missing or non-tabular are silently skipped. */
export function resolveWorkbookSheets(ws: DataSessionLike, names: string[]): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  for (const name of names) {
    const e = ws.getDataEntry(name);
    if (!e || !TABULAR_TYPES.has(e.content_type ?? "")) continue;
    const rows = extractTable(e.content_json ?? e.content);
    if (!Array.isArray(rows)) continue;
    sheets.push({ name, rows: rows as Record<string, unknown>[], columns: e.columns });
  }
  return sheets;
}

/** Project resolved sheets into a jspreadsheet-ready grid (columns + cell rows). */
export function workbookGrid(sheets: WorkbookSheet[]): { name: string; columns: string[]; rows: GridView["rows"]; total: number }[] {
  return sheets.map((s) => {
    const grid = rowsToGrid(s.rows, s.columns);
    return { name: s.name, columns: grid.columns, rows: grid.rows, total: grid.total };
  });
}
