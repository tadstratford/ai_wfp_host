import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";

export const FACTS_ENTRY = "plan_facts";
export const DIM_ENTRY = "plan_dim";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function requireWs(): WorkspaceSession {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  const ws = getSessionByDatabaseId(currentDatabaseId);
  if (!ws) throw new Error("No active workspace.");
  return ws;
}

export function readEntry<T>(ws: WorkspaceSession, name: string): T[] {
  const entry = ws.getDataEntry(name);
  return Array.isArray(entry?.content_json) ? (entry.content_json as T[]) : [];
}

export function writeEntry(
  ws: WorkspaceSession,
  name: string,
  arr: unknown[],
  columns: string[],
): void {
  ws.setDataEntry(name, {
    content: JSON.stringify(arr),
    content_type: "json_array",
    content_json: arr,
    columns,
    row_count: arr.length,
    edited_at: new Date().toISOString(),
  });
}

export function parseJsonArray(text: string, label: string): unknown[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    throw new Error(`${label} must be valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(v)) throw new Error(`${label} must be a JSON array.`);
  return v;
}

export function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
