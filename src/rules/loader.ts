/**
 * Rules Loader — loads workspace rules from wfp.rules[].
 *
 * Rules are user-authored workspace data (distinct from app skills). Loaded
 * from the active WorkspaceSession.
 */

import type { Rule } from "wfp-format/rule";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export function loadRules(databaseId: string): Rule[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws.getRules();
}
