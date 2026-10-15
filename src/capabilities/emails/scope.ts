import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function requireWorkspaceId(): string {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  const ws = getSessionByDatabaseId(currentDatabaseId);
  if (!ws?.workspaceId) throw new Error("No active workspace.");
  return ws.workspaceId;
}
