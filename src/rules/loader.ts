/**
 * Rules Loader — loads workspace-authored skills (formerly rules) from
 * `wfp.skills[]`. Rules are user-authored workspace data (distinct from app
 * skills); they are unified under the `Skill` type with `source: "workspace"`.
 */

import type { Rule } from "wfp-format/rule";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export function loadRules(databaseId: string): Rule[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws.getRules();
}
