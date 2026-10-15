import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { parseCsv } from "@shared/wfp-api/csv";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export async function requireKey(): Promise<string> {
  const ws = getSessionByDatabaseId(currentDatabaseId ?? "");
  const userId = ws?.userId;
  if (!userId) {
    throw new Error("No active workspace for Jev key resolution.");
  }
  return getClassifierKey(userId);
}

/** Resolve a data entry into an array of row objects, or null when not tabular. */
export function toRows(entry: {
  content: unknown;
  content_type?: string | null;
  content_json?: unknown;
}): Record<string, unknown>[] | null {
  if (Array.isArray(entry.content_json)) {
    return entry.content_json as Record<string, unknown>[];
  }
  if ((entry.content_type === "csv" || entry.content_type === "json_array") &&
      typeof entry.content === "string") {
    if (entry.content_type === "csv") {
      return parseCsv(entry.content) as Record<string, unknown>[];
    }
    try {
      const parsed = JSON.parse(entry.content);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not JSON — fall through */
    }
  }
  return null;
}

/** Names of the normalized `synth_<name>_*` tables derived from a raw sheet. */
export function synthSiblings(ws: { getDataNames(): string[] }, name: string): string[] {
  return ws.getDataNames()
    .filter((n) => n.startsWith(`synth_${name}_`))
    .sort();
}
