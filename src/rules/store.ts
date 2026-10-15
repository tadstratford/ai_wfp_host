/**
 * Rules Store — CRUD for user rules on WorkspaceSession.
 *
 * User rules are stored in wfp.rules[] on the workspace document.
 */

import type { Rule } from "wfp-format/rule";

export function getRules<T extends { rules?: Rule[] }>(wfp: T): Rule[] {
  return structuredClone(wfp.rules ?? []);
}

export function getRule<T extends { rules?: Rule[] }>(
  wfp: T,
  name: string,
): Rule | null {
  const found = wfp.rules?.find((s) => s.name === name);
  return found ? structuredClone(found) : null;
}

export function upsertRule<T extends { rules?: Rule[] }>(
  wfp: T,
  rule: Rule,
): void {
  if (!wfp.rules) wfp.rules = [];

  const idx = wfp.rules.findIndex((s) => s.name === rule.name);
  const entry: Rule = {
    ...structuredClone(rule),
    updated_at: new Date().toISOString(),
  };

  if (!entry.created_at) {
    entry.created_at = entry.updated_at;
  }

  if (idx >= 0) {
    wfp.rules[idx] = entry;
  } else {
    wfp.rules.push(entry);
  }
}

export function deleteRule<T extends { rules?: Rule[] }>(
  wfp: T,
  name: string,
): boolean {
  if (!wfp.rules) return false;
  const idx = wfp.rules.findIndex((s) => s.name === name);
  if (idx < 0) return false;
  wfp.rules.splice(idx, 1);
  return true;
}
