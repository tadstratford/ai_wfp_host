/**
 * Skill groups service — resolves a database's enabled skill groups from
 * admin_users.skills_enabled and warms the in-memory loader cache so
 * loadAppSkills/loadAllSkills apply per-user filtering.
 *
 * Distinguishes "no preference stored" (falls back to DEFAULT_SKILL_GROUP_KEYS)
 * from an explicitly stored empty list (everything disabled). Every async entry
 * point that decides which skills the LLM can see should call
 * `ensureEnabledSkillGroups(databaseId)` before building prompts.
 */

import { userManager } from "./userManager";
import { setEnabledGroupsForDatabase } from "@core/skills/loader";
import { DEFAULT_SKILL_GROUP_KEYS } from "@shared/skillGroups";

/** Resolve and cache a database's enabled skill group keys. Returns the effective list. */
export async function ensureEnabledSkillGroups(
  databaseId: string,
): Promise<string[]> {
  let effective: string[];
  const stored = await userManager.getStoredSkillGroupsByDatabaseId(databaseId);
  if (stored === null) {
    effective = [...DEFAULT_SKILL_GROUP_KEYS];
  } else {
    effective = stored;
  }
  setEnabledGroupsForDatabase(databaseId, effective);
  return effective;
}

/** Persist a user's enabled skill group keys and refresh the loader cache. */
export async function saveEnabledSkillGroups(
  userId: string,
  databaseId: string,
  groupKeys: string[],
): Promise<string[]> {
  const keys = groupKeys.filter(
    (k, i) => groupKeys.indexOf(k) === i,
  );
  await userManager.saveSkillGroups(userId, keys);
  setEnabledGroupsForDatabase(databaseId, keys);
  return keys;
}