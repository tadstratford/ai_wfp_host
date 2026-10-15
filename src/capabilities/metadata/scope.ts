import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function requireWs() {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  return getSessionByDatabaseId(currentDatabaseId)!;
}
