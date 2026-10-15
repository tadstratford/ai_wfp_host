// Shared "persist a typed envelope into the workspace data map" path.
//
// Used by both the workflow WFP_API (`api.setData`) and the chat `save_data`
// MCP tool so chat-produced data follows the exact same rules as workflow-
// produced data: name sanitization, reserved-name protection, envelope →
// DataEntry conversion, and automatic privacy-mask discovery.

import { rowsToCsv } from "@shared/wfp-api/csv";
import type { TypedEnvelope } from "wfp-api";
import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { buildAutoMask } from "@backend/core/knowledge/autoMask";

const RESERVED = new Set([
  "metadata",
  "workflows",
  "tools",
  "data",
  "knowledge",
  "sessions",
]);

/** Normalize a user-supplied name to the `[a-z0-9_]` shape used by data keys. */
export function sanitizeDataName(name: unknown): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
}

/**
 * Persist a typed envelope into the workspace's `data` map and refresh the
 * automatic privacy mask for the saved entry. Returns the sanitized name the
 * entry was stored under.
 */
export function saveDataEntry(
  databaseId: string,
  rawName: string,
  envelope: TypedEnvelope,
): { name: string } {
  const safeName = sanitizeDataName(rawName);
  if (!safeName) {
    throw new Error(
      "setData: name must contain at least one alphanumeric character",
    );
  }
  if (RESERVED.has(safeName)) {
    throw new Error(
      `setData: "${safeName}" is a reserved name and cannot be used.`,
    );
  }

  const ws = requireSessionByDatabaseId(databaseId);
  const existing = ws.getDataEntry(safeName);
  const now = new Date().toISOString();
  const meta = envelope._meta;
  const data = envelope.data;

  let content: string;
  let contentJson: unknown | undefined;
  let columns: string[] | undefined = meta.columns;
  let rowCount: number | undefined = meta.rowCount;

  if (meta.type === "json_array" || meta.type === "json_object") {
    content = typeof data === "string" ? data : JSON.stringify(data);
    contentJson = data;
    if (
      !columns &&
      Array.isArray(data) &&
      data.length > 0 &&
      typeof data[0] === "object"
    ) {
      columns = Object.keys(data[0]);
    }
    if (rowCount === undefined && Array.isArray(data)) rowCount = data.length;
  } else if (meta.type === "csv") {
    if (typeof data === "string") {
      content = data;
    } else if (Array.isArray(data)) {
      content = rowsToCsv(data as Record<string, unknown>[], columns);
      if (!columns && data.length > 0 && typeof data[0] === "object") {
        columns = Object.keys(data[0] as object);
      }
      if (rowCount === undefined) rowCount = data.length;
    } else {
      content = JSON.stringify(data);
    }
  } else {
    content = typeof data === "string" ? data : JSON.stringify(data);
  }

  ws.setDataEntry(safeName, {
    content,
    content_type:
      meta.type === "json_array" ||
      meta.type === "json_object" ||
      meta.type === "json_cells" ||
      meta.type === "csv"
        ? meta.type
        : "text",
    ...(contentJson !== undefined ? { content_json: contentJson } : {}),
    ...(columns ? { columns } : {}),
    ...(rowCount !== undefined ? { row_count: rowCount } : {}),
    source_filename: existing?.source_filename ?? null,
    loaded_at: existing?.loaded_at ?? now,
    edited_at: now,
  });

  // Discover sensitive values and merge them into the automatic privacy map so
  // the saved data is masked consistently with uploaded/workflow data.
  try {
    buildAutoMask(databaseId, safeName);
  } catch {
    /* masking is best-effort; never block the save */
  }

  return { name: safeName };
}
