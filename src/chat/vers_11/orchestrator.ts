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
import { getSystemSkillNames } from "../vers_8/getSkillsPrompt";
import { route } from "../vers_8/skillRouter";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import type { OrchestratorIO } from "../vers_9/orchestrator";
import { selectRules } from "./select";
import { classifyRule } from "./classifyRule";
import { composePlan } from "./composePlan";
import { executePlan, emitPlanMessage, persistPlan } from "./executePlan";
import { resumePlan } from "./resume";
import type { ClassifiedRule, SelectedRule, TurnPlan } from "./types";
import type { MetaData } from "wfp-api";

const GUARDRAILS_SKILL = "guardrails";

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

  // ── Rule selection + classification ───────────────────────────────────────
  const selectedRules: SelectedRule[] = await selectRules(io.databaseId, io.userId, rawMessage, {
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

  if (classified.length > 0) {
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
  const plan = await composePlan({
    databaseId: io.databaseId,
    userId: io.userId,
    rawMessage,
    mode: io.mode,
    selectedSkills,
    selectedRules: classified,
    mutating: decision.mutating,
    complexity: decision.complexity,
    lastRequest: meta.lastRequest,
    clarifiedParams: meta.clarifiedParams,
  });

  const reviewShaped = routedSkills.includes("data-account-check");

  await persistPlan(io, plan);
  await emitPlanMessage(io, plan);
  await executePlan({ plan, io, session, rawMessage, reviewShaped });
  await persistToolCalls(io, plan);

  console.log("[vers_11] Pipeline finished.\n");
}
