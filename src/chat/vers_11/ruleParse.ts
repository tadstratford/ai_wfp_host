/**
 * ruleParse — split a user-authored rule's markdown into its three sections.
 *
 * A rule mirrors a skill: `## Instructions` (the method), `## Tools needed`
 * (which tools the method uses), and `## Rules` (the enforcement constraints).
 * The client writes prose; the harness parses it here so the planner can follow
 * the instructions and the enforcement layer can classify the rules.
 */

import type { ToolRef } from "wfp-format/rule";

export interface ParsedRule {
  /** Each numbered instruction's text (## Instructions). */
  instructions: string[];
  /** Tool names the rule references (authoritative, from the structured field). */
  tools: string[];
  /** Each bullet under `## Rules` (raw, markers preserved). */
  rules: string[];
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** Lines directly under a top-level `## <name>` heading, trimmed + non-empty. */
function extractSection(content: string, headingName: string): string[] {
  const lines = (content ?? "").split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) {
      inSection = h[1].trim().toLowerCase() === headingName.toLowerCase();
      continue;
    }
    if (!inSection) continue;
    const t = line.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Extract the `## Instructions` steps. A step starts on a `1.` / `1)` line; any
 * following non-empty, non-heading line (indented sub-bullets, wrapped prose) is
 * appended to the current step rather than becoming its own instruction.
 */
function extractInstructions(content: string): string[] {
  const lines = (content ?? "").split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  let current: string | null = null;
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) {
      inSection = h[1].trim().toLowerCase() === "instructions";
      continue;
    }
    if (!inSection) continue;
    const t = line.trim();
    if (!t) continue;
    const numbered = t.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      if (current !== null) out.push(current);
      current = numbered[1].trim();
    } else if (current !== null) {
      current += " " + t.replace(/^[-*]\s*/, "").trim();
    }
  }
  if (current !== null) out.push(current);
  return out;
}

export function parseRule(content: string, tools?: ToolRef[]): ParsedRule {
  const instructions = extractInstructions(content).filter(Boolean);
  const ruleTools = (tools ?? []).map((t) => t.name);
  const rules = extractSection(content, "rules")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return { instructions, tools: ruleTools, rules };
}

/** True when the rule's body references a capability tool (qbo_* / qbodemo_*)
 *  — i.e. the rule is a method/instruction rule for a specific capability, not
 *  a generic data check. */
export function referencesCapabilityTools(content: string): boolean {
  return /\b(qbo|qbodemo)_[a-z0-9_]+\b/i.test(content ?? "");
}
