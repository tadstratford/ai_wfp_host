/**
 * Rules Loader — loads workspace-authored skills (formerly rules) from
 * `wfp.skills[]`. Rules are user-authored workspace data (distinct from app
 * skills); they are unified under the `Skill` type with `source: "workspace"`.
 */

import type { Rule } from "wfp-format/rule";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/** Load the workspace's own skills (source: "workspace"). */
export function loadWorkspaceSkills(databaseId: string): Rule[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws.getRules();
}

/** @deprecated alias for `loadWorkspaceSkills` — kept for the migration. */
export const loadRules = loadWorkspaceSkills;
