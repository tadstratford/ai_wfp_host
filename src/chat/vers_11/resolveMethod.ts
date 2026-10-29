/**
 * resolveMethod — the compute ladder, per instruction (advisory).
 *
 * Each `## Instructions` step of a rule resolves to a rung, deterministic-first:
 *   tool     — the step names a declared tool (run it; no model)
 *   spec     — classify/flag/split/measure → the LLM emits a RuleSpec, code computes
 *   judgment — a yes/no over data → check_data (Jev)
 *   gap      — none of the above → bridged by the planner / clarification
 *
 * The rung is classification metadata only; it never blocks a turn. Enforcement
 * (fail-closed "did the plan actually cover the rule's declared tools?") lives in
 * `composePlan` as a coverage gate, not a prose guess here.
 */

import type { ParsedRule } from "./ruleParse";

export type Rung = "tool" | "spec" | "judgment" | "gap";

export interface ResolveOutcome {
  instruction: string;
  rung: Rung;
  tool?: string;
}

const SPEC_HINT = /\b(classif|flag|split|allocat|measure|distribut|proportion|percent|ratio|sum|total|foot)\b/i;
const JUDGMENT_HINT = /\b(check|valid|missing|exist|equal|within|must|should)\b/i;

function findTool(instruction: string, tools: string[]): string | undefined {
  return tools.find((name) => instruction.includes(name));
}

export function resolveInstruction(instruction: string, tools: string[]): ResolveOutcome {
  const tool = findTool(instruction, tools);
  if (tool) return { instruction, rung: "tool", tool };
  if (SPEC_HINT.test(instruction)) return { instruction, rung: "spec" };
  if (JUDGMENT_HINT.test(instruction)) return { instruction, rung: "judgment" };
  return { instruction, rung: "gap" };
}

export function resolveMethod(rule: ParsedRule): ResolveOutcome[] {
  return rule.instructions.map((instruction) => resolveInstruction(instruction, rule.tools));
}
