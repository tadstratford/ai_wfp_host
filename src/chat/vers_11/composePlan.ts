/**
 * composePlan — build the turn's materialized plan.
 *
 * Order of assembly:
 *   1. story-progress anchor (communication)
 *   2. data steps from the planner (cascade, then llm — no loop)
 *   3. rule-check data steps (LLM-composed) placed BEFORE any write
 *   4. approval control step placed before the first mutating/durable write
 *   5. "unproven" disclosures for downgraded / audit-tier rules
 *   6. rule-report marker (communication, resolved by the executor)
 */

import { getPlanner } from "../plan/planner";
import type { PlanRequest, PlanResult } from "../plan/planner";
import { isDurableTool, isMutatingTool, listCapabilities } from "../../capabilities/registry";
import { enabledSkillNamesForDatabase } from "../../core/skills/loader";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { composeRuleChecks } from "./composeRuleChecks";
import type { ClassifiedRule, DataStep, Step, TurnPlan } from "./types";

const ROUTING_TOOLS = new Set(["select_skill", "list_skills"]);

function disabledToolNames(databaseId: string): Set<string> {
  const enabledSkills = enabledSkillNamesForDatabase(databaseId);
  const out = new Set<string>();
  for (const cap of listCapabilities()) {
    const m = cap.manifest;
    const enabled = !m.group || (m.skills ?? []).some((s) => enabledSkills.has(s));
    if (!enabled) for (const t of cap.tools) out.add(t.name);
  }
  return out;
}

async function buildToolRoster(databaseId: string): Promise<{ name: string; description: string }[]> {
  const capability = await getCapabilityIndex();
  const disabled = disabledToolNames(databaseId);
  return [...capability.tools.values()]
    .filter((t) => !ROUTING_TOOLS.has(t.name) && !disabled.has(t.name))
    .map((t) => ({ name: t.name, description: t.description }));
}

export interface ComposeInput {
  databaseId: string;
  userId: string;
  rawMessage: string;
  mode: string;
  selectedSkills: string[];
  selectedRules: ClassifiedRule[];
  mutating: number;
  complexity: number;
  lastRequest?: string;
  clarifiedParams?: Record<string, unknown>;
}

export async function composePlan(input: ComposeInput): Promise<TurnPlan> {
  const roster = await buildToolRoster(input.databaseId);

  const planRequest: PlanRequest = {
    databaseId: input.databaseId,
    userId: input.userId,
    rawMessage: input.rawMessage,
    tools: roster,
    activeSkills: input.selectedSkills,
    lastRequest: input.lastRequest,
    complexity: input.complexity,
    mutating: input.mutating,
    clarifiedParams: input.clarifiedParams,
  };

  // cascade → llm. No free-form loop: every request is a plan.
  let result: PlanResult;
  try {
    result = await getPlanner("cascade").plan(planRequest);
  } catch (err: any) {
    result = { kind: "fallback", reason: `cascade planner failed: ${err.message}` };
  }
  if (result.kind !== "plan") {
    try {
      result = await getPlanner("llm").plan(planRequest);
    } catch (err: any) {
      result = { kind: "fallback", reason: `llm planner failed: ${err.message}` };
    }
  }

  const steps: Step[] = [];

  if (result.kind === "clarify") {
    steps.push({
      kind: "control",
      control: "clarify",
      prompt: result.question ?? `I need more information: ${(result.missing ?? []).join(", ")}.`,
      status: "pending",
    });
    return {
      id: `plan-${Date.now().toString(36)}`,
      steps,
      cursor: 0,
      provenance: { skills: input.selectedSkills, rules: input.selectedRules.map((r) => r.rule) },
      createdAt: new Date().toISOString(),
    };
  }

  if (result.kind !== "plan") {
    steps.push({
      kind: "communication",
      message: { markdown: `I couldn't compose a plan for this request (${result.reason ?? "no plan"}).` },
      status: "pending",
    });
    return {
      id: `plan-${Date.now().toString(36)}`,
      steps,
      cursor: 0,
      provenance: { skills: input.selectedSkills, rules: input.selectedRules.map((r) => r.rule) },
      createdAt: new Date().toISOString(),
    };
  }

  const dataSteps: DataStep[] = result.plan.steps.map((s) => ({
    kind: "data",
    tool: s.tool_id,
    args: s.tool_parameters,
    label: s.label || s.tool_id,
    durable: isDurableTool(s.tool_id),
    status: "pending",
  }));

  // 2) rule checks (always run — they are read-only checks).
  const { steps: ruleSteps, downgraded } = await composeRuleChecks({
    databaseId: input.databaseId,
    userId: input.userId,
    rawMessage: input.rawMessage,
    rules: input.selectedRules,
  });

  // 3) find the write boundary — first mutating/durable data step.
  const writeIdx = dataSteps.findIndex((s) => isMutatingTool(s.tool) || s.durable === true);
  const mutatingRequest = input.mode === "build" && input.mutating >= 0.5 && writeIdx >= 0;

  // Assemble: data steps, with rule checks and the approval gate injected at the
  // write boundary (rule checks run BEFORE the gate).
  const assembled: Step[] = [];
  if (mutatingRequest) {
    assembled.push(...dataSteps.slice(0, writeIdx));
    assembled.push(...ruleSteps);
    assembled.push({
      kind: "control",
      control: "approval",
      prompt: "This request will create, modify, or send data. Approve to continue.",
      status: "pending",
    });
    assembled.push(...dataSteps.slice(writeIdx));
  } else {
    assembled.push(...dataSteps);
    assembled.push(...ruleSteps);
  }

  // 4) "unproven" disclosures.
  for (const d of downgraded) {
    assembled.push({
      kind: "communication",
      message: { markdown: `⚠ \`${d.rule.name}\` — not proven (${d.reason})` },
      status: "pending",
    });
  }
  for (const r of input.selectedRules) {
    if (r.tier === "audit") {
      assembled.push({
        kind: "communication",
        message: { markdown: `⚠ \`${r.rule.name}\` — reviewed (audit), not proven by a deterministic check` },
        status: "pending",
      });
    }
  }

  return {
    id: `plan-${Date.now().toString(36)}`,
    steps: assembled,
    cursor: 0,
    provenance: { skills: input.selectedSkills, rules: input.selectedRules.map((r) => r.rule) },
    createdAt: new Date().toISOString(),
  };
}
