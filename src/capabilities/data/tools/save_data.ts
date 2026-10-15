import { z } from "zod";
import { defineTool } from "../../tool";
import { getDatabaseId } from "../scope";
import { saveDataEntry, sanitizeDataName } from "@data";
import { extractTable } from "@data/table";
import { WFP_META_TYPES } from "@mcp/types";
import type { MetaData } from "wfp-api";

export default defineTool({
  name: "save_data",
  description: "Saves a typed value into the workspace's durable data map so it persists beyond this chat. The name is stored with a chat_ prefix (except staging_* names, which stay unprefixed so they match the workflow's setData). The data is automatically checked for sensitive values and added to the privacy mask.",
  class: "control",
  output: { metaType: "text", tabular: false },
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Name for the saved data. Stored as chat_<name> (or as-is when it starts with staging_); must contain at least one alphanumeric character."),
    value: z.string().describe("The value as a string. For numbers: pass the digits. For booleans: 'true'/'false'. For objects/arrays: pass a JSON string."),
    type: z.enum(WFP_META_TYPES).optional().default("string").describe("WFP envelope type — determines how the data is stored and later read back."),
    source: z.string().optional().describe("Provenance tag (e.g. 'chat')."),
    columns: z.array(z.string()).optional().describe("Column names — only meaningful when type is 'json_array' or 'csv'."),
    rowCount: z.number().optional().describe("Number of rows — only meaningful when type is 'json_array' or 'csv'."),
  },
  handler: async ({ name, value, type, source, columns, rowCount }) => {
    const db = getDatabaseId();
    if (!db) {
      return { content: [{ type: "text" as const, text: "No active workspace." }], isError: true };
    }

    let parsed: unknown = value;
    if (type === "number") {
      const n = Number(value);
      if (isNaN(n)) return { content: [{ type: "text" as const, text: `Invalid number: "${value}"` }], isError: true };
      parsed = n;
    } else if (type === "boolean") {
      parsed = value === "true";
    } else if (type === "json_array") {
      try { parsed = JSON.parse(value); }
      catch { return { content: [{ type: "text" as const, text: `Invalid JSON for type "json_array": ${value.slice(0, 200)}` }], isError: true }; }
      const table = extractTable(parsed);
      if (table) parsed = table;
      else if (!Array.isArray(parsed)) {
        return { content: [{ type: "text" as const, text: "save_data: value is not an array for type json_array." }], isError: true };
      }
    } else if (type === "json_object") {
      try { parsed = JSON.parse(value); }
      catch { return { content: [{ type: "text" as const, text: `Invalid JSON for type "json_object": ${value.slice(0, 200)}` }], isError: true }; }
    }

    const base = sanitizeDataName(name);
    if (!base) {
      return { content: [{ type: "text" as const, text: "save_data: name must contain at least one alphanumeric character." }], isError: true };
    }

    const storedName = base.startsWith("staging_") ? base : `chat_${base}`;

    const meta: MetaData = { type };
    if (source) meta.source = source;
    if (columns) meta.columns = columns;
    if (rowCount !== undefined) meta.rowCount = rowCount;

    try {
      const { name: stored } = saveDataEntry(db, storedName, { _meta: meta, data: parsed });
      return { content: [{ type: "text" as const, text: `Data saved as "${stored}" and privacy-masked.` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `save_data failed: ${err.message}` }], isError: true };
    }
  },
});
