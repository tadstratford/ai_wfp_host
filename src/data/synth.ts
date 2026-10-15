// Automatic data synthesis — splits a `json_cells` entry (a formatted report /
// multi-table sheet held as a cell-address map) back into clean, named tables.
//
// Flow:
//   1. Structure mapping — an LLM identifies table boundaries from a
//      VALUE-FREE sparse grid (addresses only, nothing sensitive leaves).
//   2. Deterministic extraction — rows are sliced out of the unmasked cell map
//      and typed with the same code the loader uses; numbers are never
//      LLM-transcribed.
//   3. Write `synth_<parent>_<slug>` entries as first-class `csv` data objects.
//
// Runs fire-and-forget after every `json_cells` load, so the synthetic tables
// are available to both chat and workflows without a user-facing step.

import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";
import { llmCall } from "@backend/core/llm/llmCall";
import {
  stage,
  buildTable,
  rowsToCsv,
  cellMapToGrid,
  gridToCsv,
  slugify,
  cellGridTitle,
  colIndexToLetters,
  type StagedTable,
} from "./stage";

interface SynthTable {
  slug: string;
  table: StagedTable;
}

const SYNTH_SOURCE = "data_synth";

// ── Structure mapping ────────────────────────────────────────────────────────

/** Ask the LLM to identify tables from a value-free sparse grid. Returns null
 *  on failure (no key, bad response, no tables) so the caller can fall back. */
async function llmTables(
  grid: string[][],
  databaseId: string,
): Promise<SynthTable[] | null> {
  // Value-free description: one line per row with its non-empty column letters.
  const sparse: string[] = [];
  for (let r = 0; r < grid.length; r++) {
    const cols: string[] = [];
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if ((row[c] ?? "").trim() !== "") cols.push(colIndexToLetters(c));
    }
    if (cols.length > 0) sparse.push(`${r + 1}:${cols.join(",")}`);
  }

  const result = await llmCall(databaseId, SYNTH_SOURCE, {
    systemPrompt:
      'You are given a spreadsheet as a list of non-empty cells, one line per row, format "rownumber:col,col,…" (1-based row numbers, spreadsheet column letters).\n' +
      "Identify the rectangular data tables embedded in it. Each table has a header row followed by data rows. Blocks are separated by empty rows or single-cell title/note rows.\n" +
      'Return JSON only (no prose) in this exact shape:\n' +
      '{"tables":[{"header_row":1,"first_data_row":2,"last_data_row":5}]}\n' +
      "header_row/first_data_row/last_data_row are 1-based row numbers. Exclude single-cell title rows, totals rows, and notes. If no table is found, return {\"tables\":[]}.",
    messages: [{ role: "user", content: sparse.join("\n") }],
    responseFormat: "json",
    maxTokens: 2000,
  });

  const data = result.data as { tables?: unknown[] } | null;
  if (!data || !Array.isArray(data.tables) || data.tables.length === 0) {
    return null;
  }

  const tables: SynthTable[] = [];
  for (const raw of data.tables) {
    const t = raw as Record<string, unknown>;
    if (
      typeof t.header_row !== "number" ||
      typeof t.first_data_row !== "number" ||
      typeof t.last_data_row !== "number"
    ) {
      continue;
    }
    const headerRow = t.header_row - 1;
    const firstRow = t.first_data_row - 1;
    const lastRow = t.last_data_row - 1;
    if (
      headerRow < 0 ||
      firstRow < headerRow ||
      lastRow < firstRow ||
      headerRow >= grid.length
    ) {
      continue;
    }
    const headerCells = grid[headerRow] ?? [];
    const rawRows = grid.slice(firstRow, Math.min(lastRow, grid.length - 1) + 1);
    const slug =
      slugify(cellGridTitle(grid, headerRow) ?? "") ?? `table_${tables.length + 1}`;
    tables.push({ slug, table: buildTable(headerCells, rawRows, headerRow) });
  }
  return tables.length > 0 ? tables : null;
}

/** Deterministic fallback: reuse the loader's stage() heuristics on the grid. */
function deterministicTables(grid: string[][]): SynthTable[] {
  const staged = stage(gridToCsv(grid));
  return staged.tables.map((t, i) => {
    const slug = slugify(cellGridTitle(grid, t.headerIndex) ?? "") ?? `table_${i + 1}`;
    return { slug, table: t };
  });
}

// ── Write ────────────────────────────────────────────────────────────────────

function writeSynth(
  session: WorkspaceSession,
  parent: string,
  tables: SynthTable[],
): string[] {
  const now = new Date().toISOString();
  const parentEntry = session.getDataEntry(parent);
  const sourceFilename = parentEntry?.source_filename ?? null;

  // Drop stale synthetic tables for this parent (idempotent re-synth).
  for (const n of session.getDataNames()) {
    if (n.startsWith(`synth_${parent}_`)) session.deleteDataEntry(n);
  }

  const names: string[] = [];
  for (const { slug, table } of tables) {
    const childName = `synth_${parent}_${slug}`;
    session.setDataEntry(childName, {
      content: rowsToCsv(table.columns, table.rawRows),
      content_type: "csv",
      content_json: table.rows,
      columns: table.columns,
      row_count: table.rows.length,
      column_types: table.columnTypes as unknown as Record<string, string>,
      header_row: 0,
      source_filename: sourceFilename,
      loaded_at: now,
      group: parent,
    });
    names.push(childName);
  }
  return names;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Synthesize clean tables from a `json_cells` data entry. Returns the created
 *  entry names (empty if the entry isn't a cell map or no tables found). */
export async function synthesize(
  databaseId: string,
  name: string,
): Promise<string[]> {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return [];

  const entry = session.getDataEntry(name);
  if (!entry || entry.content_type !== "json_cells") return [];

  const cells =
    entry.content_json &&
    typeof entry.content_json === "object" &&
    !Array.isArray(entry.content_json)
      ? (entry.content_json as Record<string, string>)
      : {};
  if (Object.keys(cells).length === 0) return [];

  const grid = cellMapToGrid(cells);

  // 1. LLM structure mapping (value-free) — preferred for arbitrary layouts.
  let tables: SynthTable[] | null = null;
  try {
    tables = await llmTables(grid, databaseId);
  } catch {
    tables = null;
  }

  // 2. Deterministic fallback when the LLM is unavailable or found nothing.
  if (!tables || tables.length === 0) {
    tables = deterministicTables(grid);
  }
  if (tables.length === 0) return [];

  return writeSynth(session, name, tables);
}
