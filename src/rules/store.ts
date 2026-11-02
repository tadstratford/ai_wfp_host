/**
 * Rules Store — CRUD for workspace-authored skills on WorkspaceSession.
 *
 * Workspace-authored skills (formerly "rules") are stored in `wfp.skills[]` on
 * the workspace document. Legacy `wfp.rules[]` is read on the way in and
 * migrated to `skills[]` by the session's `normalizeWfp`; the store only writes
 * `skills[]`.
 */

import type { Skill } from "wfp-format/skill";
import type { Rule } from "wfp-format/rule";

type WithSkills = { skills?: Skill[]; rules?: Rule[] };

function readSkills(wfp: WithSkills): Skill[] {
  return (wfp.skills ?? wfp.rules ?? []).map((s) => ({
    ...s,
    source: s.source ?? "workspace",
  }));
}

export function getRules<T extends WithSkills>(wfp: T): Skill[] {
  return structuredClone(readSkills(wfp));
}

export function getRule<T extends WithSkills>(
  wfp: T,
  name: string,
): Skill | null {
  const found = readSkills(wfp).find((s) => s.name === name);
  return found ? structuredClone(found) : null;
}

export function upsertRule<T extends WithSkills>(
  wfp: T,
  rule: Skill,
): void {
  if (!wfp.skills) wfp.skills = readSkills(wfp);

  const idx = wfp.skills.findIndex((s) => s.name === rule.name);
  const entry: Skill = {
    ...structuredClone(rule),
    source: rule.source ?? "workspace",
    updated_at: new Date().toISOString(),
  };

  if (!entry.created_at) {
    entry.created_at = entry.updated_at;
  }

  if (idx >= 0) {
    wfp.skills[idx] = entry;
  } else {
    wfp.skills.push(entry);
  }
}

export function deleteRule<T extends WithSkills>(
  wfp: T,
  name: string,
): boolean {
  const list = readSkills(wfp);
  if (list.length === 0) return false;
  wfp.skills = list.filter((s) => s.name !== name);
  return wfp.skills.length < list.length;
}
