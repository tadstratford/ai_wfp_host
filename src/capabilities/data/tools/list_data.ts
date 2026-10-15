import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "list_data",
  description: "Lists all data files loaded in the workspace with type, row count, and source info.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  handler: async () => {
    const ws = requireWs();
    const names = ws.getDataNames();
    const entries = names.map((name) => {
      const e = ws.getDataEntry(name);
      return {
        name,
        content_type: e?.content_type ?? "unknown",
        row_count: e?.row_count ?? null,
        columns: e?.columns ?? null,
        column_types: e?.column_types ?? null,
        source_filename: e?.source_filename ?? null,
        loaded_at: e?.loaded_at ?? null,
        shape_candidates: e?.shape_candidates ?? null,
        resolved_shape: e?.resolved_shape ?? null,
      };
    });
    const text = entries.length === 0
      ? "No data files loaded."
      : JSON.stringify(entries, null, 2);
    return { content: [{ type: "text" as const, text }] };
  },
});
