/**
 * Skill groups service — resolves a workspace's enabled skill-group ids and
 * warms the in-memory loader cache so loadAppSkills applies per-workspace
 * filtering.
 *
 * The canonical home of the enabled-group preference is the workspace's `.wfp`
 * metadata (`metadata.enabled_skill_groups`), keyed by the stable group id — so
 * renaming a group's label never breaks the preference. `admin_users.skills_enabled`
 * is kept in sync for backward-compat and is the fallback for workspaces not yet
 * migrated (no `.wfp` entry).
 *
 * Distinguishes "no preference stored" (falls back to DEFAULT_SKILL_GROUP_KEYS)
 * from an explicitly stored empty list (everything disabled). Every async entry
 * point that decides which skills the LLM can see should call
 * `ensureEnabledSkillGroups(databaseId)` before building prompts.
 */

import { userManager } from "./userManager";
import { setEnabledGroupsForDatabase } from "@core/skills/loader";
import {
  DEFAULT_SKILL_GROUP_KEYS,
  normalizeGroupKeys,
} from "@shared/skillGroups";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

function wfpEnabledGroups(databaseId: string): string[] | null {
  try {
    const meta = getSessionByDatabaseId(databaseId)?.getMetadata();
    return Array.isArray(meta?.enabled_skill_groups)
      ? (meta!.enabled_skill_groups as string[])
      : null;
  } catch {
    return null;
  }
}

function writeWfpEnabledGroups(databaseId: string, keys: string[]): void {
  try {
    getSessionByDatabaseId(databaseId)?.updateMetadata({ enabled_skill_groups: keys });
  } catch {
    /* workspace not open — admin_users remains the source of truth */
  }
}

/** Resolve and cache a workspace's enabled skill-group keys. Returns the effective list. */
export async function ensureEnabledSkillGroups(
  databaseId: string,
): Promise<string[]> {
  let effective: string[];
  const wfpKeys = wfpEnabledGroups(databaseId);
  if (wfpKeys !== null) {
    effective = normalizeGroupKeys(wfpKeys);
  } else {
    const stored = await userManager.getStoredSkillGroupsByDatabaseId(databaseId);
    effective = normalizeGroupKeys(stored ?? DEFAULT_SKILL_GROUP_KEYS);
    writeWfpEnabledGroups(databaseId, effective);
  }
  setEnabledGroupsForDatabase(databaseId, effective);
  return effective;
}

/** Persist a workspace's enabled skill-group keys (`.wfp` metadata + admin_users). */
export async function saveEnabledSkillGroups(
  userId: string,
  databaseId: string,
  groupKeys: string[],
): Promise<string[]> {
  const keys = normalizeGroupKeys(groupKeys);
  await userManager.saveSkillGroups(userId, keys);
  writeWfpEnabledGroups(databaseId, keys);
  setEnabledGroupsForDatabase(databaseId, keys);
  return keys;
}
