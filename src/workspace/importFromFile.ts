import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { DataEntry, Rule } from "wfp-format";

/**
 * Imports a rule or a data entry from another .wfp file into the active
 * workspace. Rules and data have no dependents and are keyed by name, so the
 * only rule is: copy it in, and if the name is already used, suffix "(2)",
 * "(3)", … until it is unique.
 */

function nextName(used: Set<string>, name: string): string {
  if (!used.has(name)) return name;
  let suffix = 2;
  while (used.has(`${name} (${suffix})`)) suffix++;
  return `${name} (${suffix})`;
}

export type ImportRuleResult = { kind: "added"; name: string };

export function importRuleFromFile(databaseId: string, rule: Rule): ImportRuleResult {
  const session = requireSessionByDatabaseId(databaseId);
  const used = new Set(session.getRules().map((s) => s.name));
  const name = nextName(used, rule.name);

  const clone: Rule = structuredClone(rule);
  clone.name = name;
  clone.updated_at = new Date().toISOString();
  if (!clone.created_at) clone.created_at = clone.updated_at;

  session.upsertRule(clone);
  return { kind: "added", name };
}

export type ImportDataResult = { kind: "added"; name: string };

export function importDataFromFile(
  databaseId: string,
  sourceName: string,
  entry: DataEntry,
): ImportDataResult {
  const session = requireSessionByDatabaseId(databaseId);
  const used = new Set(session.getDataNames());
  const name = nextName(used, sourceName);

  session.setDataEntry(name, structuredClone(entry));
  return { kind: "added", name };
}
