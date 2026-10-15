/**
 * Skill Rules — parsable rule-checking for skill markdown.
 *
 * Skills can define a `## Rules` section with checkable conditions.
 * Same format as knowledge pack success factors:
 *
 *   ## Rules
 *   - [deterministic] Every journal entry has at least 2 lines.
 *   - [audit] The memo is clear and descriptive.
 *
 * deterministic = a computable assertion checked in code.
 * audit         = a judgment delegated to a separate LLM audit pass.
 */

import type { Skill } from "wfp-format/skill";

export type RuleMode = "deterministic" | "audit";

export interface SkillRule {
  mode: RuleMode;
  condition: string;
}

const RULES_HEADING = "Rules";

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const RULE_RE = /^\s*[-*]\s*\[(deterministic|audit)\]\s*(.+)$/i;

function isRulesHeading(text: string): boolean {
  return text.trim().toLowerCase() === RULES_HEADING.toLowerCase();
}

/**
 * Extract the rules from a skill's markdown content.
 * Returns [] when the skill has no `## Rules` section.
 */
export function parseSkillRules(content: string): SkillRule[] {
  const lines = (content ?? "").split(/\r?\n/);
  const rules: SkillRule[] = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      inSection = isRulesHeading(heading[1]);
      continue;
    }
    if (!inSection) continue;

    const m = line.match(RULE_RE);
    if (m) {
      const condition = m[2].trim();
      if (condition) {
        rules.push({ mode: m[1].toLowerCase() as RuleMode, condition });
      }
    }
  }

  return rules;
}

export function hasSkillRules(content: string): boolean {
  return parseSkillRules(content).length > 0;
}

export function getSkillRules(skill: Skill): SkillRule[] {
  return parseSkillRules(skill.content);
}
