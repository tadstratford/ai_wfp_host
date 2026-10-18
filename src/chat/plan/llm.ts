/**
 * llm planner — a single full-LLM call that produces an ordered plan for any
 * request the deterministic templates (cascade) can't compose. The universal
 * fallback: Jev isn't needed to gate shape here, only to produce the plan; the
 * orchestrator then runs the same fail-closed missing-arg check + write gate +
 * execution it uses for every other plan.
 *
 * The planner is told the full tool roster with each tool's parameter schema and
 * asked to emit a JSON array of steps. The result is normalized and validated
 * deterministically (unknown tool / missing required arg → fallback) so a
 * hallucinated plan can never run.
 */

import type { Planner, PlanRequest, PlanResult } from "./planner";
import type { NodePlan, PlanStep } from "./types";
import { z } from "zod";
import { callStructured } from "@backend/core/llm/structured";
import { getToolParams } from "../extract/schema";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";

const PlanSchema = z.object({
  steps: z.array(
    z.object({
      tool_id: z.string(),
      tool_parameters: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

const PLAN_SYSTEM =
  "You plan a data/analysis workflow as an ordered list of existing tools. " +
  "Return ONLY a JSON object: {\"steps\": [{\"tool_id\": \"...\", \"tool_parameters\": {...}}]}. " +
  "Use only the tools listed. Resolve every required parameter from the request, a clear default, or a named data entry (source/name); never invent data-file names. " +
  "Structured tool inputs (rows, entries, items, lines, summary, details, source, name) must reference a named data entry, not a previous step's raw output. " +
  "Use the literal string \"{{result}}\" ONLY for sink parameters that consume the previous step's output for delivery or persistence (e.g. chat_download.data, save_data.value). " +
  "Produce the minimal complete plan that delivers the user's outcome.";

/** Parameters where `{{result}}` is a valid value — delivery/persistence sinks
 *  that consume the previous step's raw output. Everywhere else `{{result}}`
 *  would feed an untyped raw value into a structured input. */
const RESULT_SINK_PARAMS = new Set(["chat_download.data", "save_data.value"]);

export const llmPlanner: Planner = {
  id: "llm",
  async plan(req: PlanRequest): Promise<PlanResult> {
    const catalog: string[] = [];
    for (const t of req.tools) {
      const params = await getToolParams(t.name);
      const paramStr = params.length
        ? params
            .map(
              (p) =>
                `${p.name}${p.required ? " (required)" : ""} [${p.type}${
                  p.enum?.length ? ", one of " + p.enum.join("|") : ""
                }]${p.description ? ": " + p.description : ""}`,
            )
            .join("; ")
        : "no parameters";
      catalog.push(`${t.name} — ${t.description || ""}\n  ${paramStr}`);
    }

    let privacyMap = loadPrivacyMap(req.databaseId);
    const probe = { system: "", messages: [{ role: "user", content: req.rawMessage }] };
    const { added } = discoverRequestValues(req.databaseId, probe);
    if (added > 0) privacyMap = loadPrivacyMap(req.databaseId);
    const masked = privacyMap ? maskText(req.rawMessage, privacyMap) : req.rawMessage;

    const parsed = await callStructured({
      databaseId: req.databaseId,
      schema: PlanSchema,
      toolName: "emit_plan",
      toolDescription: "Emit the ordered workflow plan as a JSON object matching the schema.",
      system: PLAN_SYSTEM,
      userMessage: `Tools:\n${catalog.join("\n")}\n\nRequest: ${masked}`,
      maxTokens: 4000,
      temperature: 0.2,
      callOpts: { userId: req.userId, mode: "chat", phase: "plan" },
    });

    if (!parsed || parsed.steps.length === 0) {
      return { kind: "fallback", reason: "llm planner produced no valid steps" };
    }

    const allowed = new Set(req.tools.map((t) => t.name));
    const steps: PlanStep[] = [];
    for (const s of parsed.steps) {
      if (!allowed.has(s.tool_id)) {
        return { kind: "fallback", reason: `llm planner picked unknown tool "${s.tool_id}"` };
      }
      const tool_parameters = s.tool_parameters ?? {};
      steps.push({ tool_id: s.tool_id, tool_parameters, label: s.tool_id });
    }

    // Fail closed: every required argument must be present.
    const missingRequired: string[] = [];
    for (const step of steps) {
      const params = await getToolParams(step.tool_id);
      for (const p of params) {
        if (p.required && step.tool_parameters[p.name] === undefined) {
          missingRequired.push(`${step.tool_id}.${p.name}`);
        }
      }
    }
    if (missingRequired.length > 0) {
      return { kind: "clarify", missing: missingRequired };
    }

    // `{{result}}` may only feed a delivery/persistence sink. Wired into any
    // other parameter it would push an untyped raw value into a structured
    // input — reject the plan and fall back to the build loop.
    for (const step of steps) {
      for (const [k, v] of Object.entries(step.tool_parameters)) {
        if (v === "{{result}}" && !RESULT_SINK_PARAMS.has(`${step.tool_id}.${k}`)) {
          return {
            kind: "fallback",
            reason: `{{result}} wired into non-sink parameter ${step.tool_id}.${k}`,
          };
        }
      }
    }

    const plan: NodePlan = { steps };
    return { kind: "plan", plan, missingRequired: [] };
  },
};
