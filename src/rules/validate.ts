/**
 * Rules validation — the workspace-open check that a rule's structured tool
 * references point at real tools. Run at open (results cached for the Rules
 * panel) and again in `create_rule`/`update_rule` so a bad tool name fails at
 * authoring time instead of silently producing an empty plan later.
 *
 * Only checks tool *existence* here. Capability enablement is checked at
 * request time by the compose plan (disabled-capability warning + coverage
 * gate), where the enabled skill groups are loaded.
 */

import type { Rule, ToolRef } from "wfp-format/rule";
import { getCapabilityIndex } from "@mcp/capabilityIndex";

export interface RuleIssue {
  rule: string;
  kind: "unknown_tool";
  tool: string;
  message: string;
}

const issuesByDatabase = new Map<string, RuleIssue[]>();

/** Cache the latest validation result for the Rules panel badge. */
export function setRuleIssues(databaseId: string, issues: RuleIssue[]): void {
  issuesByDatabase.set(databaseId, issues);
}

export function getRuleIssues(databaseId: string): RuleIssue[] {
  return issuesByDatabase.get(databaseId) ?? [];
}

/** The tool names a rule references — every one must exist in the tool surface. */
async function knownToolNames(): Promise<Set<string>> {
  const index = await getCapabilityIndex();
  return new Set(index.tools.keys());
}

export async function findUnknownTools(tools: ToolRef[]): Promise<string[]> {
  const known = await knownToolNames();
  return tools.map((t) => t.name).filter((n) => !known.has(n));
}

/** Validate a set of rules against the tool surface. Returns one issue per
 *  unknown tool reference (rule × tool). */
export async function validateRules(rules: Rule[]): Promise<RuleIssue[]> {
  const known = await knownToolNames();
  const issues: RuleIssue[] = [];
  for (const r of rules) {
    for (const t of r.tools ?? []) {
      if (!known.has(t.name)) {
        issues.push({
          rule: r.name,
          kind: "unknown_tool",
          tool: t.name,
          message: `unknown tool "${t.name}"`,
        });
      }
    }
  }
  return issues;
}

/** Validate and cache for a workspace (open-time hook). */
export async function refreshRuleIssues(databaseId: string, rules: Rule[]): Promise<RuleIssue[]> {
  try {
    const issues = await validateRules(rules);
    setRuleIssues(databaseId, issues);
    return issues;
  } catch (err: any) {
    console.warn(`[rules] validation skipped: ${err.message}`);
    return [];
  }
}
