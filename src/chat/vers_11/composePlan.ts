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

import { getPlanner } from "./plan/planner";
import type { PlanRequest, PlanResult } from "./plan/planner";
import { getToolClass, isDurableTool, isMutatingTool, listCapabilities } from "../../capabilities/registry";
import { enabledSkillNamesForDatabase } from "../../core/skills/loader";
import { getCapabilityIndex } from "@mcp/capabilityIndex";
import { COMPOSABLE_PRIMITIVES } from "./plan/primitives";
import { withTimeout } from "./util";
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

async function buildToolRoster(
  databaseId: string,
  selectedSkills: string[],
  selectedRules: ClassifiedRule[],
): Promise<{ roster: { name: string; description: string }[]; disabledRuleTools: string[] }> {
  const capability = await getCapabilityIndex();
  const disabled = disabledToolNames(databaseId);
  // Tools follow skills AND rules: the planner sees the routed skills' declared
  // tools plus the selected rules' `## Tools needed` plus the composable
  // primitives — not the full capability surface (which would dilute a one-shot
  // LLM plan and widen the hallucination surface).
  const declared = new Set<string>();
  for (const skill of selectedSkills) {
    const entry = capability.skills.get(skill);
    if (entry) for (const t of entry.tools) declared.add(t);
  }
  // A rule that names tools its method needs — surfaced even when the skill that
  // owns those tools wasn't routed. A disabled-capability tool is flagged so the
  // user gets an actionable error instead of a silently-empty plan.
  const disabledRuleTools: string[] = [];
  for (const cr of selectedRules) {
    for (const t of cr.rule.tools ?? []) {
      declared.add(t.name);
      if (disabled.has(t.name) && !disabledRuleTools.includes(t.name)) disabledRuleTools.push(t.name);
    }
  }
  const roster = [...capability.tools.values()]
    .filter(
      (t) =>
        !ROUTING_TOOLS.has(t.name) &&
        !disabled.has(t.name) &&
        (declared.has(t.name) || COMPOSABLE_PRIMITIVES.includes(t.name)),
    )
    .map((t) => ({ name: t.name, description: t.description }));
  return { roster, disabledRuleTools };
}

export interface ComposeInput {
  databaseId: string;
  userId: string;
  sessionId?: string;
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
  const { roster, disabledRuleTools } = await buildToolRoster(
    input.databaseId,
    input.selectedSkills,
    input.selectedRules,
  );

  // The selected rules' full markdown, injected so the planner can follow the
  // client's method exactly (accounts, month, tool calls).
  const guidance = input.selectedRules.length > 0
    ? input.selectedRules.map((r) => `## Rule: ${r.rule.name}\n${r.rule.content}`).join("\n\n")
    : undefined;

  const planRequest: PlanRequest = {
    databaseId: input.databaseId,
    userId: input.userId,
    sessionId: input.sessionId,
    rawMessage: input.rawMessage,
    tools: roster,
    activeSkills: input.selectedSkills,
    lastRequest: input.lastRequest,
    complexity: input.complexity,
    mutating: input.mutating,
    clarifiedParams: input.clarifiedParams,
    guidance,
  };

  // cascade → llm. No free-form loop: every request is a plan. Planner calls are
  // bounded so a hang surfaces as a fallback instead of silently stalling.
  let result: PlanResult;
  try {
    result = await withTimeout(getPlanner("cascade").plan(planRequest), 30_000, "cascade planner");
  } catch (err: any) {
    result = { kind: "fallback", reason: `cascade planner failed: ${err.message}` };
  }
  if (result.kind !== "plan") {
    try {
      result = await withTimeout(getPlanner("llm").plan(planRequest), 60_000, "llm planner");
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
      missing: result.missing ?? [],
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

  // A destructive-write step (external post/send/delete) that comes AFTER the
  // write boundary is gated a second time, so a "preview → confirm → post" rule
  // can show the computed lines before the external change is made.
  const destructiveIdx = dataSteps.findIndex((s) => getToolClass(s.tool) === "destructive-write");

  // Assemble: data steps, with rule checks and the approval gate injected at the
  // write boundary (rule checks run BEFORE the gate).
  const assembled: Step[] = [];

  // A rule that names a disabled-capability tool is surfaced up front — the
  // plan would otherwise silently omit the work the client asked for.
  if (disabledRuleTools.length > 0) {
    assembled.push({
      kind: "communication",
      message: {
        markdown:
          `⚠ This request's rules need tools from a disabled capability: ${disabledRuleTools.map((t) => `\`${t}\``).join(", ")}. ` +
          `Enable the capability and try again.`,
      },
      status: "pending",
    });
  }

  // A method rule whose declared `## Tools needed` are missing from the plan is
  // surfaced fail-closed: the plan would otherwise silently omit work the client
  // asked for. (Disabled capabilities are surfaced separately above.)
  const plannedTools = new Set(dataSteps.map((s) => s.tool));
  const missingRuleTools: string[] = [];
  for (const r of input.selectedRules) {
    for (const t of r.rule.tools ?? []) {
      if (!plannedTools.has(t.name) && !disabledRuleTools.includes(t.name)) {
        missingRuleTools.push(`\`${r.rule.name}\` needs \`${t.name}\``);
      }
    }
  }
  if (missingRuleTools.length > 0) {
    assembled.push({
      kind: "control",
      control: "clarify",
      prompt:
        "I can't run this request because the plan is missing tool(s) the activated rules require:\n" +
        missingRuleTools.map((s) => `- ${s}`).join("\n") +
        "\n\nAdd the tool to the plan or enable the capability, then try again.",
      status: "pending",
    });
  }

  if (mutatingRequest) {
    assembled.push(...dataSteps.slice(0, writeIdx));
    assembled.push(...ruleSteps);
    assembled.push({
      kind: "control",
      control: "approval",
      prompt: "This request will create, modify, or send data. Approve to continue.",
      status: "pending",
    });
    if (destructiveIdx > writeIdx) {
      assembled.push(...dataSteps.slice(writeIdx, destructiveIdx));
      assembled.push({
        kind: "control",
        control: "approval",
        prompt:
          `The next step (\`${dataSteps[destructiveIdx].tool}\`) posts or sends data externally. ` +
          `Review the preview above and approve to continue.`,
        status: "pending",
      });
      assembled.push(...dataSteps.slice(destructiveIdx));
    } else {
      assembled.push(...dataSteps.slice(writeIdx));
    }
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
