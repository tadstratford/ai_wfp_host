/**
 * classifyRule — auto-classify a rule's enforcement tier by keyword-matching its
 * text against the deterministic/classified tool families.
 *
 * Pure (no model, no tool-catalog lookup): the mapping is a keyword → tool-name
 * table. The tool names are the deterministic data tools that already implement
 * the check (reconcile_relationship, aggregate_data, split_data, profile_data)
 * and the Jev-backed classifier (check_data). A rule that matches none of these
 * falls back to `audit` — an LLM review that is reported as "not proven".
 */

import type { ClassifiedRule, RuleTier, SelectedRule } from "./types";

interface ToolMatcher {
  tool: string;
  re: RegExp;
}

const DETERMINISTIC: ToolMatcher[] = [
  { tool: "reconcile_relationship", re: /reconcil|tie[- ]?out|variance|mismatch|\bdiff(erence)?\b|agreement|\bmatch\b/ },
  { tool: "split_data", re: /split|50\s*\/\s*50|percent|proportion|ratio/ },
  { tool: "aggregate_data", re: /\bsum\b|\btotal\b|foot|cross[- ]?foot|\bnet\b|\bequal\b|balance|roll ?up/ },
  { tool: "profile_data", re: /\bblank\b|duplicate|\bnull\b|missing|complet/ },
];

const CLASSIFIED: ToolMatcher[] = [
  { tool: "check_data", re: /must be in|\blist\b|member|valid|allowed|permissible|categor|classif|coded|\bexist/ },
];

export function classifyRule(rule: SelectedRule): ClassifiedRule {
  const text = `${rule.name} ${rule.description ?? ""} ${rule.content}`.toLowerCase();

  for (const { tool, re } of DETERMINISTIC) {
    if (re.test(text)) {
      return { rule, tier: "deterministic" as RuleTier, tool, reason: `matches ${tool}` };
    }
  }
  for (const { tool, re } of CLASSIFIED) {
    if (re.test(text)) {
      return { rule, tier: "classified" as RuleTier, tool, reason: `matches ${tool}` };
    }
  }
  return { rule, tier: "audit" as RuleTier, reason: "no deterministic/classified tool matches" };
}
