import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, maskRow, pickColumns, buildMasker, DEFAULT_LIMIT, MAX_LIMIT } from "../scope";
import { readCsvPage } from "@data/stage";

export default defineTool({
  name: "get_data",
  description: "Reads a loaded data file in pages. For tabular data (csv/json_array) it returns a page of up to 500 rows (use offset to page forward, check has_more to know when to stop). For text/json_object files it returns the whole content.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  inputSchema: {
    name: z.string().describe("Data file name"),
    offset: z.number().int().min(0).optional().describe("0-based row index to start from. Defaults to 0."),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows per page. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
    columns: z.array(z.string()).optional().describe("Optional list of column names to return only those columns."),
  },
  handler: async ({ name, offset, limit, columns }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }

    const masker = buildMasker();

    if (entry.content_type === "json_cells") {
      const cellsRaw =
        entry.content_json && typeof entry.content_json === "object"
          ? (entry.content_json as Record<string, unknown>)
          : {};
      const cells: Record<string, unknown> = {};
      for (const [addr, v] of Object.entries(cellsRaw)) {
        cells[addr] = typeof v === "string" ? masker.mask(v) : v;
      }
      const result = {
        name,
        content_type: "json_cells",
        cell_count: Object.keys(cells).length,
        cells,
        note: "Raw sheet stored as a cell-address map (a1, b2, …). Values are strings; empty cells are omitted.",
        shape_candidates: entry.shape_candidates ?? null,
        resolved_shape: entry.resolved_shape ?? null,
        source_filename: entry.source_filename ?? null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    const start = offset ?? 0;
    const size = limit ?? DEFAULT_LIMIT;
    const columnsFilter = columns?.length ? new Set(columns) : null;

    if (entry.large && typeof entry.content === "string" && entry.header_row != null) {
      const page = readCsvPage(entry.content, {
        headerIndex: entry.header_row,
        keyColumns: entry.key_columns ?? [],
        offset: start,
        limit: size,
      });
      const colNames = entry.columns ?? [];
      let pageRows = page.rows.map((cells) => {
        const obj: Record<string, unknown> = {};
        colNames.forEach((c, i) => {
          obj[c] = masker.mask(cells[i] ?? "");
        });
        return obj;
      });
      if (columnsFilter) pageRows = pageRows.map((r) => pickColumns(r, columnsFilter));

      const result = {
        name,
        content_type: entry.content_type ?? "csv",
        columns: columns ?? (entry.columns ?? []),
        column_types: entry.column_types ?? null,
        total_rows: entry.row_count ?? 0,
        offset: start,
        limit: pageRows.length,
        rows: pageRows,
        has_more: start + pageRows.length < (entry.row_count ?? 0),
        source_filename: entry.source_filename ?? null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    const rows = toRows(entry);

    if (rows === null) {
      const result = {
        name,
        content_type: entry.content_type ?? "text",
        content:
          entry.content_json ??
          (typeof entry.content === "string" ? entry.content : null),
        has_more: false,
        source_filename: entry.source_filename ?? null,
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }

    const page = rows
      .slice(start, start + size)
      .map((row) => maskRow(row, masker))
      .map((row) => (columnsFilter ? pickColumns(row, columnsFilter) : row));

    const result = {
      name,
      content_type: entry.content_type ?? "csv",
      columns: columns ?? (entry.columns ?? (page.length > 0 ? Object.keys(page[0]) : [])),
      column_types: entry.column_types ?? null,
      total_rows: rows.length,
      offset: start,
      limit: page.length,
      rows: page,
      has_more: start + page.length < rows.length,
      source_filename: entry.source_filename ?? null,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  },
});
