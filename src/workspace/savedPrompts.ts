/**
 * Workspace Saved Prompts Store
 *
 * Backed by the active WorkspaceSession's `saved_prompts` array (top-level
 * `.wfp` node). A "saved prompt" is a snippet of composer text the user chose
 * to keep (via the composer's save button), so they can re-use it with one
 * click. Modeled on todoStore.ts.
 */

import { requireSessionByDatabaseId, getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { SavedPrompt } from "wfp-format";

/** Hard cap on retained saved prompts per workspace (newest kept). */
const MAX_SAVED_PROMPTS = 50;

export function addSavedPrompt(databaseId: string, text: string): SavedPrompt | null {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  const ws = requireSessionByDatabaseId(databaseId);
  const existing = ws.getSavedPrompts();

  // De-duplicate identical text: move it to the top (newest) instead of adding.
  const rest = existing.filter((p) => p.prompt !== clean);
  const created: SavedPrompt = {
    id: crypto.randomUUID(),
    prompt: clean,
    created_at: new Date().toISOString(),
  };

  const next = [created, ...rest].slice(0, MAX_SAVED_PROMPTS);
  ws.setSavedPrompts(next);
  return created;
}

export function listSavedPrompts(databaseId: string): SavedPrompt[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws.getSavedPrompts().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export function deleteSavedPrompt(databaseId: string, id: string): boolean {
  const ws = requireSessionByDatabaseId(databaseId);
  const existing = ws.getSavedPrompts();
  const next = existing.filter((p) => p.id !== id);
  if (next.length === existing.length) return false;
  ws.setSavedPrompts(next);
  return true;
}
