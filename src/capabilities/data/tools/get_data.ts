import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, maskRow, pickColumns, buildMasker, DEFAULT_LIMIT, MAX_LIMIT } from "../scope";
import { readCsvPage } from "@data/stage";

/** Read a single data entry into the same result shape the tool has always
 *  returned. Extracted so both the single-`name` and multi-`names` paths share
 *  one code path. */
function readOne(
  name: string,
  entry: any,
  offset: number,
  limit: number,
  columns?: string[],
  masker = buildMasker(),
): Record<string, unknown> {
  const columnsFilter = columns?.length ? new Set(columns) : null;

  if (entry.content_type === "xlsx") {
    return {
      name,
      content_type: "xlsx",
      note: "Source workbook (original .xlsx) — download-only, not tabular data.",
      source_filename: entry.source_filename ?? null,
    };
  }

  if (entry.content_type === "json_cells") {
    const cellsRaw =
      entry.content_json && typeof entry.content_json === "object"
        ? (entry.content_json as Record<string, unknown>)
        : {};
    const cells: Record<string, unknown> = {};
    for (const [addr, v] of Object.entries(cellsRaw)) {
      cells[addr] = typeof v === "string" ? masker.mask(v) : v;
    }
    return {
      name,
      content_type: "json_cells",
      cell_count: Object.keys(cells).length,
      cells,
      note: "Raw sheet stored as a cell-address map (a1, b2, …). Values are strings; empty cells are omitted.",
      shape_candidates: entry.shape_candidates ?? null,
      resolved_shape: entry.resolved_shape ?? null,
      source_filename: entry.source_filename ?? null,
    };
  }

  if (entry.large && typeof entry.content === "string" && entry.header_row != null) {
    const page = readCsvPage(entry.content, {
      headerIndex: entry.header_row,
      keyColumns: entry.key_columns ?? [],
      offset,
      limit,
    });
    const colNames: string[] = entry.columns ?? [];
    let pageRows = page.rows.map((cells: string[]) => {
      const obj: Record<string, unknown> = {};
      colNames.forEach((c: string, i: number) => {
        obj[c] = masker.mask(cells[i] ?? "");
      });
      return obj;
    });
    if (columnsFilter) pageRows = pageRows.map((r) => pickColumns(r, columnsFilter));

    return {
      name,
      content_type: entry.content_type ?? "csv",
      columns: columns ?? (entry.columns ?? []),
      column_types: entry.column_types ?? null,
      total_rows: entry.row_count ?? 0,
      offset,
      limit: pageRows.length,
      rows: pageRows,
      has_more: offset + pageRows.length < (entry.row_count ?? 0),
      source_filename: entry.source_filename ?? null,
    };
  }

  const rows = toRows(entry);

  if (rows === null) {
    return {
      name,
      content_type: entry.content_type ?? "text",
      content:
        entry.content_json ??
        (typeof entry.content === "string" ? entry.content : null),
      has_more: false,
      source_filename: entry.source_filename ?? null,
    };
  }

  const page = rows
    .slice(offset, offset + limit)
    .map((row) => maskRow(row, masker))
    .map((row) => (columnsFilter ? pickColumns(row, columnsFilter) : row));

  return {
    name,
    content_type: entry.content_type ?? "csv",
    columns: columns ?? (entry.columns ?? (page.length > 0 ? Object.keys(page[0]) : [])),
    column_types: entry.column_types ?? null,
    total_rows: rows.length,
    offset,
    limit: page.length,
    rows: page,
    has_more: offset + page.length < rows.length,
    source_filename: entry.source_filename ?? null,
  };
}

export default defineTool({
  name: "get_data",
  description:
    "Reads a loaded data file in pages. For tabular data (csv/json_array) it returns a page of up to 500 rows (use offset to page forward, check has_more to know when to stop). For text/json_object files it returns the whole content. Pass `names` (an array) to read several files in one call — each is returned under `tables` (a page of up to 500 rows each), so a multi-sheet workbook can be loaded in a single round-trip instead of one call per sheet.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  present: true,
  inputSchema: {
    name: z.string().optional().describe("Data file name (single read)."),
    names: z
      .array(z.string())
      .min(1)
      .max(50)
      .optional()
      .describe("Read several data files at once. Returns each under `tables`."),
    offset: z.number().int().min(0).optional().describe("0-based row index to start from. Defaults to 0."),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows per page. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
    columns: z.array(z.string()).optional().describe("Optional list of column names to return only those columns."),
  },
  handler: async ({ name, names, offset, limit, columns }) => {
    const ws = requireWs();
    const masker = buildMasker();
    const start = offset ?? 0;
    const size = limit ?? DEFAULT_LIMIT;

    if (names && names.length > 0) {
      const tables: Record<string, unknown>[] = [];
      const missing: string[] = [];
      for (const n of names) {
        const entry = ws.getDataEntry(n);
        if (!entry) {
          missing.push(n);
          continue;
        }
        tables.push(readOne(n, entry, start, size, columns, masker));
      }
      const result = {
        names,
        requested: names.length,
        returned: tables.length,
        missing,
        tables,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    if (!name) {
      return {
        content: [{ type: "text" as const, text: 'Provide "name" (a single data file) or "names" (an array of data files).' }],
        isError: true,
      };
    }

    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }

    const result = readOne(name, entry, start, size, columns, masker);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});
