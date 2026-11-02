/**
 * vers_11 orchestrator — "rule-aware", plan-first.
 *
 * Every request becomes a materialized `TurnPlan` (data / communication /
 * control steps) that is built, executed, and maintained across turns:
 *
 *   route skills → select+classify rules → composePlan → executePlan
 *   (paused control steps are resumed on the next message)
 *
 * Rules are enforced as data steps placed BEFORE the write gate; a flagged rule
 * blocks the approval control step. No free-form loop — the planner chain
 * (cascade → llm) always produces a plan.
 */

import { setAllScopes } from "../../mcp/scope";
import { setAppHook, setSessionDatabaseId, setSessionId } from "../../mcp/servers/app-wfp-sessions";
import { setBuildContext } from "../../mcp/servers/app-wfp-build";
import { setDiaryContext } from "../../mcp/servers/app-diary";
import { setRunDepth, setRunSessionId } from "@workflow/runContext";
import { getSession, updateSession, saveSession } from "@backend/core/session/sessions/session_all";
import { setParameterValue, getParameterValue, getParameterMetaValue } from "@backend/core/settings/parameterHelpers";
import { getSystemSkillNames } from "./getSkillsPrompt";
import { route } from "./skillRouter";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import type { OrchestratorIO } from "./types";
import { selectRules } from "./select";
import { classifyRule } from "./classifyRule";
import { selectArchetype } from "./story/select";
import { composePlan } from "./composePlan";
import { executePlan, emitPlanMessage, persistPlan } from "./executePlan";
import { resumePlan } from "./resume";
import { persistClarifiedParams } from "./plan/clarify";
import { loadConfig } from "./config";
import type { ClassifiedRule, SelectedRule, TurnPlan } from "./types";
import type { MetaData } from "wfp-api";

const GUARDRAILS_SKILL = "guardrails";

/** Cap the classify-options list shown in the thinking stream — the full ranked
 *  distribution stays on `decision.skills`, but the card shows a readable few. */
const CLASSIFY_OPTIONS_MAX = 6;

/** Cap the rule-selection options shown in the thinking stream. */
const RULE_OPTIONS_MAX = 6;

function safeStringify(v: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(v ?? {});
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch {
    return String(v ?? "");
  }
}

/** Record the executed data steps into `metadata.toolCalls` so "save as
 *  workflow" can generalize the turn (durable steps kept, others ephemeral). */
async function persistToolCalls(io: OrchestratorIO, plan: TurnPlan): Promise<void> {
  const ran = plan.steps.slice(0, plan.cursor).filter((s) => s.kind === "data" && s.status === "done");
  if (ran.length === 0) return;
  try {
    const fresh = await getSession(io.databaseId, io.sessionId);
    if (!fresh) return;
    const metadata = (fresh.metadata ?? {}) as any;
    const prev = Array.isArray(metadata.toolCalls) ? metadata.toolCalls : [];
    const tools = ran.map((s) => ({
      tool: (s as any).tool,
      args: safeStringify((s as any).args, (s as any).durable ? 1_000_000 : 4000),
      wf_indicator: (s as any).durable === true,
    }));
    metadata.toolCalls = [...prev, { at: new Date().toISOString(), tools }];
    await updateSession(io.databaseId, io.sessionId, "metadata", metadata);
  } catch (err: any) {
    console.error("[vers_11] persistToolCalls failed:", err.message);
  }
}

export async function processUserMessage(
  rawMessage: string,
  session: any,
  io: OrchestratorIO,
): Promise<void> {
  setAllScopes(io.databaseId);
  setSessionDatabaseId(io.databaseId);
  setSessionId(io.sessionId);
  setRunDepth(0);
  setRunSessionId(io.sessionId);
  setBuildContext({ databaseId: io.databaseId, userId: io.userId, sessionId: io.sessionId });
  setDiaryContext({ databaseId: io.databaseId });
  setAppHook({
    addMessage: async (msg) => { await io.addMessage(msg); },
    setParameter: (name: string, value: unknown, meta?: MetaData) => {
      session.parameters = setParameterValue(session.parameters, name, { _meta: meta ?? { type: "string" }, data: value });
      saveSession(io.databaseId, session).catch(() => {});
    },
    getParameter: (name: string) => getParameterValue(session.parameters, name, io.databaseId),
    getParameterMeta: (name: string) => getParameterMetaValue(session.parameters, name, io.databaseId),
  });

  const meta = (session?.metadata as any) ?? {};

  // ── Resume a paused plan ──────────────────────────────────────────────────
  const existingPlan = meta.plan as TurnPlan | undefined;
  if (existingPlan && existingPlan.cursor < existingPlan.steps.length) {
    const step = existingPlan.steps[existingPlan.cursor];
    if (step && step.kind === "control") {
      // Explicit cancel discards the plan.
      if (step.control === "approval" && /^(cancel|no|stop|never mind)$/i.test(rawMessage.trim())) {
        await updateSession(io.databaseId, io.sessionId, "metadata", { ...meta, plan: undefined });
        await io.addMessage({ markdown: "Cancelled.", json: { kind: "meta" } });
        return;
      }
      // Clarify resume — resolve the answer into typed params, then re-compose a
      // fresh plan (the clarify step itself carries no data steps, so simply
      // advancing the cursor would dead-end). Mirrors vers_8's clarification resume.
      if (step.control === "clarify") {
        const fresh = (await getSession(io.databaseId, io.sessionId)) ?? session;
        const clarified = await persistClarifiedParams(fresh, step.missing ?? [], rawMessage);
        const freshMeta: any = { ...((fresh.metadata as any) ?? {}), plan: undefined };
        if (Object.keys(clarified).length > 0) freshMeta.clarifiedParams = clarified;
        await updateSession(io.databaseId, io.sessionId, "metadata", freshMeta);
        if (Object.keys(clarified).length > 0) {
          await updateSession(io.databaseId, io.sessionId, "parameters", fresh.parameters);
        }
        const combined = `${meta.lastRequest ?? rawMessage}\n${rawMessage.trim()}`;
        console.log(`[vers_11] Clarification answered → re-composing: ${combined.slice(0, 120)}`);
        await processUserMessage(combined, fresh, io);
        return;
      }
      const continued = await resumePlan({ plan: existingPlan, rawMessage, io });
      if (continued) {
        const reviewShaped = (existingPlan.provenance?.skills ?? []).includes("data-account-check");
        await executePlan({ plan: existingPlan, io, session, rawMessage, reviewShaped });
        await persistToolCalls(io, existingPlan);
      }
      return;
    }
    // Stale plan (cursor not on a control step) — discard and start fresh.
    await updateSession(io.databaseId, io.sessionId, "metadata", { ...meta, plan: undefined });
  }

  await ensureEnabledSkillGroups(io.databaseId);

  // ── Story (meta-plan) selection ──────────────────────────────────────────
  // Jev picks the story archetype (audit-review vs quick-fact) FIRST — it is the
  // meta-plan, so it is decided before skills/tools. Selection only for now: the
  // result is recorded in the plan's provenance; running the beats is a later
  // phase.
  const story = await selectArchetype(io.databaseId, io.userId, rawMessage, {
    sessionId: io.sessionId,
    mode: io.mode,
  });

  if (io.verbose) {
    const storyPrompt = "Figuring out what story this is…";
    const storyCfg = loadConfig().story;
    await io.addMessage({
      markdown:
        `**${storyPrompt}**\n` +
        story.options.map((o) => `- ${o.id} (${Math.round(o.prob * 100)}%)`).join("\n"),
      json: {
        kind: "thinking",
        stage: "story-options",
        prompt: storyPrompt,
        options: story.options.map((o) => ({ name: o.id, description: o.description, prob: o.prob })),
        limits: { threshold: storyCfg.archetypeProbThreshold, max: storyCfg.maxArchetypes, label: "stories" },
      },
    });
    await io.addMessage({
      markdown: story.archetype ? `Story: \`${story.archetype.id}\`` : "Story: none",
      json: { kind: "thinking", stage: "story-outcome", story: story.archetype?.id ?? null },
    });
  }

  // ── Skill routing ─────────────────────────────────────────────────────────
  const decision = await route(io.databaseId, io.userId, rawMessage, {
    lastRequest: meta.lastRequest,
    activeSkills: meta.lastActiveSkills,
    sessionId: io.sessionId,
    mode: io.mode,
  });

  const allSkillNames = getSystemSkillNames(io.databaseId);
  const routedSkills = decision.selectedSkills.filter((name: string) => allSkillNames.includes(name));
  const selectedSkills: string[] = Array.from(new Set([...routedSkills, GUARDRAILS_SKILL]));

  if (routedSkills.length === 0) {
    await io.addMessage({ markdown: "No matching rules found for this request.", json: { kind: "meta" } });
    console.log("[vers_11] Routing finished (no skills selected).\n");
    return;
  }

  // ── Thinking stream: classify options → outcome ────────────────────────────
  // Surface the routing decision as two visible beats (options at this point,
  // the pick at the next) so the user can follow the model's reasoning. Gated by
  // verbose (chatVerbose). No extra model call — both derive from the single
  // routing result already computed above.
  if (io.verbose) {
    const classifyPrompt = "Figuring out what type of problem this is…";
    const routingCfg = loadConfig().routing;
    const options = decision.skills.slice(0, CLASSIFY_OPTIONS_MAX).map((s) => ({
      name: s.name,
      description: s.description,
      prob: s.prob,
    }));
    await io.addMessage({
      markdown:
        `**${classifyPrompt}**\n` +
        options.map((o) => `- ${o.name} (${Math.round(o.prob * 100)}%)`).join("\n"),
      json: {
        kind: "thinking",
        stage: "classify-options",
        prompt: classifyPrompt,
        options,
        limits: { threshold: routingCfg.skillProbThreshold, max: routingCfg.maxSkills, label: "skills" },
      },
    });
    await io.addMessage({
      markdown: `Picked: ${routedSkills.map((s) => `\`${s}\``).join(", ")}`,
      json: { kind: "thinking", stage: "classify-outcome", chosen: routedSkills },
    });
  }

  // ── Rule selection + classification ───────────────────────────────────────
  const { selected: selectedRules, options: ruleOptions } = await selectRules(io.databaseId, io.userId, rawMessage, {
    lastRequest: meta.lastRequest,
    activeSkills: routedSkills,
    sessionId: io.sessionId,
    mode: io.mode,
  });
  const classified: ClassifiedRule[] = selectedRules.map((r) => classifyRule(r));

  await io.addMessage({
    markdown: `**Rules activated:** ${selectedSkills.map((s) => `\`${s}\``).join(", ")}${decision.skillSummary ? ` — Jev: ${decision.skillSummary}` : ""}`,
    json: { kind: "meta" },
  });

  if (io.verbose) {
    // Rule selection is the second decision after skill routing — surface the
    // candidate rules with relevance scores, then the applying rules + tier.
    if (ruleOptions.length > 0) {
      const rulesPrompt = "Figuring out which workspace rules apply…";
      const rulesCfg = loadConfig().rules;
      const ruleOptionList = ruleOptions.slice(0, RULE_OPTIONS_MAX).map((o) => ({
        name: o.name,
        description: o.description,
        prob: o.prob,
      }));
      await io.addMessage({
        markdown:
          `**${rulesPrompt}**\n` +
          ruleOptionList.map((o) => `- ${o.name} (${Math.round(o.prob * 100)}%)`).join("\n"),
        json: {
          kind: "thinking",
          stage: "rules-options",
          prompt: rulesPrompt,
          options: ruleOptionList,
          limits: {
            threshold: rulesCfg.probThreshold,
            tagThreshold: rulesCfg.tagThreshold,
            max: rulesCfg.maxRules,
            label: "rules",
          },
        },
      });
    }
    if (classified.length > 0) {
      await io.addMessage({
        markdown: `Rules applying: ${classified.map((c) => `\`${c.rule.name}\` (${c.tier})`).join(", ")}`,
        json: {
          kind: "thinking",
          stage: "rules-outcome",
          rules: classified.map((c) => ({ name: c.rule.name, tier: c.tier, prob: c.rule.prob })),
        },
      });
    } else if (ruleOptions.length > 0) {
      await io.addMessage({
        markdown: "No workspace rules apply.",
        json: { kind: "thinking", stage: "rules-outcome", rules: [] },
      });
    }
  } else if (classified.length > 0) {
    await io.addMessage({
      markdown: `**Rules applying:** ${classified.map((c) => `\`${c.rule.name}\` (${c.tier})`).join(", ")}`,
      json: { kind: "rules", rules: classified.map((c) => ({ name: c.rule.name, tier: c.tier, tool: c.tool })) },
    });
  }

  await updateSession(io.databaseId, io.sessionId, "metadata", {
    ...meta,
    lastActiveRules: selectedRules.map((r) => ({ name: r.name, description: r.description, content: r.content })),
    lastRequest: rawMessage,
  });

  // ── Compose + execute the plan ────────────────────────────────────────────
  if (io.verbose) {
    await io.addMessage({ markdown: "Building a plan…", json: { kind: "thinking", stage: "compose" } });
  } else {
    await io.addMessage({ markdown: "> _Composing plan…_", json: { kind: "meta", phase: "compose" } });
  }
  const plan = await composePlan({
    databaseId: io.databaseId,
    userId: io.userId,
    sessionId: io.sessionId,
    rawMessage,
    mode: io.mode,
    selectedSkills,
    selectedRules: classified,
    mutating: decision.mutating,
    complexity: decision.complexity,
    lastRequest: meta.lastRequest,
    clarifiedParams: meta.clarifiedParams,
    story: story.archetype?.id,
  });

  const reviewShaped = routedSkills.includes("data-account-check");

  // Record the selected story in the plan's provenance (consumed by the beat
  // loop in a later phase).
  if (story.archetype) {
    plan.provenance.story = story.archetype.id;
    plan.provenance.beats = story.archetype.beats.map((b) => b.id);
  }

  // ── Thinking stream: the plan the request will run ─────────────────────────
  // The plan's steps name the tools (drawn from the picked skills) + args. Show
  // them inline as the "here's the plan" beat; the right rail keeps the live
  // checklist.
  if (io.verbose) {
    const planSteps = plan.steps.map((s) =>
      s.kind === "data"
        ? { kind: "data", label: s.label, tool: s.tool, args: s.args }
        : s.kind === "control"
          ? { kind: "control", control: s.control, prompt: s.prompt }
          : { kind: "communication", label: s.message?.markdown ?? "message" },
    );
    if (planSteps.length > 0) {
      await io.addMessage({
        markdown: `**Plan**\n${plan.steps.map((s, i) => `${i + 1}. ${s.kind === "data" ? s.label : s.kind === "control" ? s.control : "message"}`).join("\n")}`,
        json: { kind: "thinking", stage: "plan", steps: planSteps },
      });
    }
  }

  await persistPlan(io, plan);
  await emitPlanMessage(io, plan);
  await executePlan({ plan, io, session, rawMessage, reviewShaped });
  await persistToolCalls(io, plan);

  console.log("[vers_11] Pipeline finished.\n");
}
