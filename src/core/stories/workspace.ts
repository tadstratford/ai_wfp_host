/**
 * Workspace story loader — merges the server-shipped story catalog with the
 * workspace's own stories (`.wfp stories[]`). A workspace story with the same id
 * as a server story wins (the user can override a shipped story).
 */

import type { StoryArchetype } from "wfp-format/story";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { loadStories } from "./loader";

/** The workspace's own stories (source: the `.wfp stories[]` node). */
export function loadWorkspaceStories(databaseId: string): StoryArchetype[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws.getStories();
}

/** Server stories + workspace stories, with workspace ids overriding server
 *  ids. Omit `databaseId` for the server catalog only. */
export function loadAllStories(databaseId?: string): StoryArchetype[] {
  const server = loadStories();
  if (!databaseId) return server;
  const workspace = loadWorkspaceStories(databaseId);
  if (workspace.length === 0) return server;
  const byId = new Map<string, StoryArchetype>();
  for (const s of server) byId.set(s.id, s);
  for (const s of workspace) byId.set(s.id, s);
  return Array.from(byId.values());
}
