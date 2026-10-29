import { defineTool } from "../../tool";
import { requireWs } from "../scope";

const MAX_COLUMNS = 30;

export default defineTool({
  name: "list_data",
  description: "Lists all data files loaded in the workspace with type, row count, and column info.",
  class: "read",
  output: { metaType: "text", tabular: false },
  present: true,
  handler: async () => {
    const ws = requireWs();
    // Source workbooks (`source_*`, content_type "xlsx") are download-only — hide
    // them from the data inventory so the model never reads base64.
    const names = ws.getDataNames().filter(
      (name) => ws.getDataEntry(name)?.content_type !== "xlsx",
    );
    if (names.length === 0) {
      return { content: [{ type: "text" as const, text: "No data files loaded." }] };
    }
    const lines = names.map((name) => {
      const e = ws.getDataEntry(name);
      const type = e?.content_type ?? "unknown";
      const rowCount = e?.row_count ?? null;
      const cols = Array.isArray(e?.columns) ? (e.columns as string[]) : [];
      const colList = cols.length === 0
        ? ""
        : ` · columns: ${cols.slice(0, MAX_COLUMNS).join(", ")}${cols.length > MAX_COLUMNS ? ", …" : ""}`;
      const rowStr = rowCount === null ? "" : `${rowCount} rows`;
      return `- **${name}** — ${type}${rowStr ? `, ${rowStr}` : ""}${colList}`;
    });
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
});
