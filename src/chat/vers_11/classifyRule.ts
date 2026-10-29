/**
 * classifyRule — assign a rule's enforcement tier.
 *
 * Two rules of thumb, deterministic-first:
 *   1. A rule that references capability tools (`qbo_*` / `qbodemo_*`) is a
 *      *method/instruction* rule, not a generic data check — it is never forced
 *      into `split_data`/`check_data`; it falls to `audit` ("not proven").
 *   2. Otherwise the rule's `## Rules` section (the enforcement constraints)
 *      is keyword-matched to the deterministic/classified data-tool families.
 *
 * Pure (no model): the map is a keyword → tool table. A rule matching none falls
 * back to `audit` — an LLM review reported as "not proven".
 */

import type { ClassifiedRule, RuleTier, SelectedRule } from "./types";
import { parseRule, referencesCapabilityTools } from "./ruleParse";

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
  // Method/instruction rules reference capability tools — not a data check.
  if (referencesCapabilityTools(rule.content)) {
    return { rule, tier: "audit" as RuleTier, reason: "references capability tools (method rule, not a data check)" };
  }

  // Classify the enforcement section (## Rules); fall back to the whole body.
  const parsed = parseRule(rule.content);
  const text = (parsed.rules.length > 0
    ? parsed.rules.join(" ")
    : `${rule.name} ${rule.description ?? ""} ${rule.content}`
  ).toLowerCase();

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
