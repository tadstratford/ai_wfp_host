import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { parseCsv } from "@shared/wfp-api/csv";
import { buildTextMasker, type TextMasker } from "@backend/core/knowledge/autoMask";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { materializeLargeRows, type StagedLarge } from "@data/stage";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

export function requireWs() {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  return getSessionByDatabaseId(currentDatabaseId)!;
}

/** Resolve a tabular data entry into an array of row objects, or null when
 *  the entry is not tabular (text / json_object / encrypted). */
export function toRows(entry: {
  content: unknown;
  content_type?: string | null;
  content_json?: unknown;
  large?: boolean;
  header_row?: number | null;
  key_columns?: string[] | null;
  columns?: string[];
}): Record<string, unknown>[] | null {
  if (Array.isArray(entry.content_json)) {
    return entry.content_json as Record<string, unknown>[];
  }
  const type = entry.content_type;
  if (type === "csv" || type === "json_array") {
    if (typeof entry.content === "string") {
      if (type === "csv") {
        if (entry.large && entry.header_row != null) {
          return materializeLargeRows(entry.content, {
            headerIndex: entry.header_row,
            keyColumns: entry.key_columns ?? [],
            columns: entry.columns ?? [],
          });
        }
        return parseCsv(entry.content);
      }
      try {
        const parsed = JSON.parse(entry.content);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* not valid JSON — fall through */
      }
    }
  }
  return null;
}

/** Mask string cell values via the automated privacy map (applied on read). */
export function maskRow(row: Record<string, unknown>, masker: TextMasker): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "string" ? masker.mask(v) : v;
  }
  return out;
}

export function pickColumns(row: Record<string, unknown>, filter: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => filter.has(k)));
}

/** Build a StagedLarge-shaped object from entry metadata (for large CSV paging). */
export function stagedFromEntry(entry: any): StagedLarge {
  return {
    columns: entry.columns ?? [],
    columnTypes: entry.column_types ?? {},
    rowCount: entry.row_count ?? 0,
    headerIndex: entry.header_row ?? 0,
    keyColumns: entry.key_columns ?? [],
  };
}

export function buildMasker(): TextMasker {
  return buildTextMasker(loadPrivacyMap(currentDatabaseId ?? "") ?? new Map<string, string>());
}
