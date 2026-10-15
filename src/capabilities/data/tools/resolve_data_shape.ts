import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";
import { cellMapToGrid, rowsToCsv } from "@data/stage";
import { classifyShapes, applyShape, registerShapes } from "@data/normalize/vers_1";

export default defineTool({
  name: "resolve_data_shape",
  description: "Resolves a raw sheet (json_cells) into a clean flat table. With no shape, lists the candidate interpretations detected at load. With a shape id, applies it deterministically and writes a synth_<name>_<shape> csv entry that analysis tools and workflows can consume. Use this before get_data/aggregate_data when a file has multiple shape_candidates and no resolved_shape.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  inputSchema: {
    name: z.string().describe("Data file name (a json_cells entry)."),
    shape: z.string().optional().describe("Shape id to apply (e.g. 'statement_detail'). Omit to list candidates only."),
  },
  handler: async ({ name, shape }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }
    if (entry.content_type !== "json_cells") {
      return { content: [{ type: "text" as const, text: `Data "${name}" is not a raw sheet (json_cells) — nothing to resolve.` }], isError: true };
    }

    const cells =
      entry.content_json && typeof entry.content_json === "object" && !Array.isArray(entry.content_json)
        ? (entry.content_json as Record<string, string>)
        : {};
    const grid = cellMapToGrid(cells);
    const candidates = classifyShapes(grid);

    if (!shape) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ name, resolved_shape: entry.resolved_shape ?? null, candidates }, null, 2),
        }],
      };
    }

    const spec = registerShapes().find((s) => s.id === shape);
    if (!spec) {
      const ids = registerShapes().map((s) => s.id).join(", ");
      return { content: [{ type: "text" as const, text: `Unknown shape "${shape}". Available: ${ids}.` }], isError: true };
    }

    const table = applyShape(grid, spec);
    const childName = `synth_${name}_${spec.id}`;
    const now = new Date().toISOString();
    ws.setDataEntry(childName, {
      content: rowsToCsv(table.columns, table.rows),
      content_type: "csv",
      content_json: table.rows.map((r) => Object.fromEntries(table.columns.map((c, i) => [c, r[i]]))),
      columns: table.columns,
      row_count: table.rows.length,
      header_row: 0,
      source_filename: entry.source_filename ?? null,
      loaded_at: now,
      group: name,
    });

    entry.resolved_shape = shape;
    ws.setDataEntry(name, entry);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ name, shape, resolved: childName, columns: table.columns, rows: table.rows.length }, null, 2),
      }],
    };
  },
});
