// CSV parsing + envelopeFromDataEntry.
//
// Runners use these at workflow start to load entries from the file's `data`
// map into typed envelopes the tool code can read. Kept in wfp-api (rather
// than wfp-core) so library consumers can hydrate a single DataEntry without
// pulling the executor.

import type { DataEntry } from "wfp-format";
import type { MetaType, TypedEnvelope } from "./types";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const lines = splitCsvLines(text);
  if (lines.length === 0) return rows;
  const headers = parseCsvLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] ?? "";
    rows.push(row);
  }
  return rows;
}

function splitCsvLines(text: string): string[] {
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

function parseCsvLine(line: string): string[] {
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

/** Serialize an array of row objects to CSV. Uses `columns` (or the keys of
 *  the first row) as the header line. Fields are quoted only when needed. */
export function rowsToCsv(
  rows: Record<string, unknown>[],
  columns?: string[],
): string {
  if (rows.length === 0) return "";
  const cols = columns && columns.length > 0 ? columns : Object.keys(rows[0]);
  const escape = (s: string): string =>
    s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  const headerLine = cols.map(escape).join(",");
  const dataLines = rows.map((r) =>
    cols.map((c) => escape(String(r[c] ?? ""))).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
}

export function envelopeFromDataEntry(entry: DataEntry): TypedEnvelope {
  const content = entry.content;
  if (typeof content !== "string") {
    // Encrypted or otherwise non-plaintext content — treat as opaque empty
    // text. The runner UI surfaces the locked state separately.
    return { _meta: { type: "text", length: 0 }, data: "" };
  }

  const type = (entry.content_type as MetaType) || "text";

  // Pre-parsed structured form takes precedence.
  if (entry.content_json !== undefined && entry.content_json !== null) {
    return {
      _meta: {
        type,
        rowCount: entry.row_count ?? undefined,
        columns: entry.columns,
      },
      data: entry.content_json,
    };
  }

  // Tabular: parse CSV / JSON array text into row objects.
  if (type === "csv" || type === "json_array") {
    const data = parseCsv(content);
    return {
      _meta: {
        type: "json_array",
        rowCount: data.length,
        columns: data.length > 0 ? Object.keys(data[0]) : [],
      },
      data,
    };
  }

  // Plain text / json_object → wrap as-is.
  return { _meta: { type, length: content.length }, data: content };
}
