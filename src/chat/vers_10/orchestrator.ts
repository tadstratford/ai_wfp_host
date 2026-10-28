/**
 * vers_10 orchestrator — "storytelling data-review".
 *
 * Breaks a review/analyze request into story beats (sets), each delivered as its
 * own message so the reader can follow the narrative:
 *
 *   persona → setup (data visualization) → status (conflict) → gap
 *          → plan → execute → resolution
 *
 * Each beat references the addressable display elements from the deterministic
 * review payload (`refs`), and a `story-progress` anchor + `story-stage` markers
 * drive a live 7-step checklist in the UI. The first four beats are read-only.
 * The `plan` beat is LLM-composed (grounded in the findings) and Jev-verified.
 * `execute` + `resolution` are **report-only** for now: they render a
 * self-contained error report behind the write-approval gate. Posting journals
 * is deferred.
 *
 * Non-review requests and the other resume states (write-approval,
 * verification-gap, clarification menu) delegate to the vers_9 flow unchanged.
 */

import { setAllScopes } from "../../mcp/scope";
import { setAppHook, setSessionDatabaseId, setSessionId } from "../../mcp/servers/app-wfp-sessions";
import { setBuildContext } from "../../mcp/servers/app-wfp-build";
import { setDiaryContext } from "../../mcp/servers/app-diary";
import { setRunDepth, setRunSessionId } from "@workflow/runContext";
import { getSession, updateSession, saveSession } from "@backend/core/session/sessions/session_all";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { setParameterValue, getParameterValue, getParameterMetaValue } from "@backend/core/settings/parameterHelpers";
import { getSystemSkillNames } from "../vers_8/getSkillsPrompt";
import { route } from "../vers_8/skillRouter";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import { verifyResult, verifyPlan } from "../vers_9/verify";
import {
  runComposedPlan,
  tryComposeReviewPlan,
  isApproval,
  processUserMessage as vers9ProcessUserMessage,
} from "../vers_9/orchestrator";
import type {
  OrchestratorIO,
  ReviewPayload,
  EvidenceItem,
} from "../vers_9/orchestrator";
import { buildRemediationPlan, findingsDigest, type StoryAction } from "./plan";
import { buildErrorReportHtml, hasFindings } from "./resolution";
import { buildReportMessage } from "@core/tools/reportRenderer";
import type { MetaData } from "wfp-api";
import type { AddMessageArgs } from "@backend/types/chat";

const GUARDRAILS_SKILL = "guardrails";
const PERSONA_RULE = "default_persona";
const STORY_STAGES = ["Persona", "Setup", "Status", "Gap", "Plan", "Execute", "Resolution"];

interface PersonaRule {
  name: string;
  description?: string;
  content: string;
}

/** The durable state that lets the write-approval resume run execute/resolution
 *  without re-running the (read-only) review battery. */
interface PendingExecute {
  rawMessage: string;
  review: ReviewPayload;
  actions: StoryAction[];
  evidence: EvidenceItem[];
  toolsUsed: string[];
  skills: string[];
}

function readPersona(databaseId: string): PersonaRule | undefined {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    const rules = (ws?.getRules?.() ?? []) as PersonaRule[];
    return rules.find((r) => r.name === PERSONA_RULE);
  } catch {
    return undefined;
  }
}

/** A short "Reading as: …" preamble from the `default_persona` rule. */
function personaMarkdown(persona: PersonaRule | undefined): string {
  if (!persona?.content) {
    return "**Reading as:** default reviewer (no `default_persona` rule set).";
  }
  const head = persona.content.trim().split(/\n+/).slice(0, 6).join("\n");
  return `**Reading as:** ${persona.description || persona.name}\n\n${head}`;
}

async function emitStoryStage(io: OrchestratorIO, index: number, status: string): Promise<void> {
  await io.addMessage({ json: { kind: "story-stage", index, status } });
}

/** Deliver a Jev verification badge (review or plan) without duplicating the
 *  markdown shape between the two call sites. */
async function emitVerdictBadge(
  io: OrchestratorIO,
  verdict: { pass: boolean; reason?: string } | null,
  opts: { satisfies?: number; complete?: number; accurate?: number; thorough?: number; grounded?: number; actionable?: number; label: string },
): Promise<void> {
  if (verdict === null) {
    await io.addMessage({
      markdown: "⚠ Result verification could not run (no classifier key).",
      json: { kind: "verify", unavailable: true },
    });
  } else if (verdict.pass) {
    const parts: string[] = [];
    if (opts.satisfies != null) parts.push(`satisfies ${opts.satisfies.toFixed(2)}`);
    if (opts.complete != null) parts.push(`complete ${opts.complete.toFixed(2)}`);
    if (opts.accurate != null) parts.push(`accurate ${opts.accurate.toFixed(2)}`);
    if (opts.thorough != null) parts.push(`thorough ${opts.thorough.toFixed(2)}`);
    if (opts.grounded != null) parts.push(`grounded ${opts.grounded.toFixed(2)}`);
    if (opts.actionable != null) parts.push(`actionable ${opts.actionable.toFixed(2)}`);
    await io.addMessage({
      markdown: `✓ Verified (${opts.label}) — ${parts.join(", ")}`,
      json: { kind: "verify", pass: true, ...opts },
    });
  } else {
    await io.addMessage({
      markdown:
        `⚠ Jev flagged this ${opts.label} for review (${verdict.reason}). ` +
        `Say "continue" to have the model address the gaps, or rephrase your request.`,
      json: { kind: "verify", pass: false, label: opts.label, reason: verdict.reason },
    });
  }
}

/** Step 6 + 7 — report-only resolution. Renders the error report and delivers it
 *  as the `resolution` story beat. */
async function runResolution(pe: PendingExecute, io: OrchestratorIO): Promise<void> {
  await io.addMessage({ markdown: "> _Rendering the error report…_", json: { kind: "meta" } });
  await emitStoryStage(io, 5, "done");

  const title = /review|audit/i.test(pe.rawMessage) ? "Data review" : "Data analysis";
  const reportHtml = buildErrorReportHtml(pe.review, pe.actions, `${title} — error report`);
  const refs = Array.from(new Set(pe.actions.flatMap((a) => a.refs)));

  // Thread one messageId through the report card and the message so the
  // `/sessions/report` route can resolve it (mirrors renderReport in createAPI).
  const messageId = Date.now().toString();
  const { html: cardHtml, json: reportJson } = buildReportMessage(
    reportHtml,
    "error-report.html",
    io.sessionId,
    undefined,
    messageId,
  );

  await io.addMessage({
    id: messageId,
    html: cardHtml,
    json: {
      kind: "story",
      bucket: "resolution",
      review: pe.review,
      actions: pe.actions,
      refs,
      skills: pe.skills,
      reportHtml,
      reportFilename: "error-report.html",
      messageId,
      contentType: reportJson.contentType,
    },
  });
  await emitStoryStage(io, 6, "done");
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

  // ── Story execute resume (write-approval for the report render) ───────────
  if (meta.pendingExecute) {
    if (isApproval(rawMessage)) {
      const pe = meta.pendingExecute as PendingExecute;
      await updateSession(io.databaseId, io.sessionId, "metadata", { ...meta, pendingExecute: undefined });
      await runResolution(pe, io);
    } else {
      await io.addMessage({
        markdown: 'Reply "approve" to render the error report, or "cancel" to stop.',
        json: { kind: "meta" },
      });
    }
    return;
  }

  // Resume states belong to the vers_9 flow (write-approval, verification-gap,
  // clarification menu) — delegate so their state machine stays in one place.
  if (meta.pendingWrite || meta.pendingVerify || meta.pendingClarify) {
    await vers9ProcessUserMessage(rawMessage, session, io);
    return;
  }

  await ensureEnabledSkillGroups(io.databaseId);

  const decision = await route(io.databaseId, io.userId, rawMessage, {
    lastRequest: (session?.metadata as any)?.lastRequest,
    activeSkills: (session?.metadata as any)?.lastActiveSkills,
    sessionId: io.sessionId,
    mode: io.mode,
  });

  const allSkillNames = getSystemSkillNames(io.databaseId);
  const routedSkills = decision.selectedSkills.filter((name: string) => allSkillNames.includes(name));
  const selectedSkills: string[] = Array.from(new Set([...routedSkills, GUARDRAILS_SKILL]));

  if (routedSkills.length === 0) {
    await io.addMessage({ markdown: "No matching rules found for this request.", json: { kind: "meta" } });
    console.log("[vers_10] Routing finished (no skills selected).\n");
    return;
  }

  await io.addMessage({
    markdown: `**Rules activated:** ${selectedSkills.map((s) => `\`${s}\``).join(", ")}${decision.skillSummary ? ` — Jev: ${decision.skillSummary}` : ""}`,
    json: { kind: "meta" },
  });

  const reviewShaped = routedSkills.some((s) => s === "data-account-check");

  if (!reviewShaped) {
    await vers9ProcessUserMessage(rawMessage, session, io);
    return;
  }

  // ── Story progress anchor + beat 1: persona ───────────────────────────────
  await io.addMessage({ json: { kind: "story-progress", stages: STORY_STAGES } });
  await io.addMessage({
    markdown: personaMarkdown(readPersona(io.databaseId)),
    json: { kind: "story", bucket: "persona", refs: [], skills: routedSkills },
  });
  await emitStoryStage(io, 0, "done");

  // ── Deterministic battery (shared with vers_9) ───────────────────────────
  const composedPlan = await tryComposeReviewPlan(io, rawMessage, selectedSkills);
  if (!composedPlan) {
    await vers9ProcessUserMessage(rawMessage, session, io);
    return;
  }
  const out = await runComposedPlan({ plan: composedPlan, io, session, rawMessage });

  if (out.pendingClarify && out.pendingClarify.length > 0) {
    // Ambiguous valuation — keep the vers_9 text menu for now.
    if (out.reply) {
      await io.addMessage({ markdown: out.reply, json: { kind: "reply", skills: routedSkills } });
    }
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingClarify: { rawMessage, candidates: out.pendingClarify },
    });
    console.log("[vers_10] awaiting clarification (valuation menu).\n");
    return;
  }

  const review: ReviewPayload | undefined = out.review;
  if (!review) {
    if (out.reply) {
      await io.addMessage({ markdown: out.reply, json: { kind: "reply", skills: routedSkills } });
    }
    return;
  }

  // ── Story beats 2–4: setup → status → gap ────────────────────────────────
  const nodeRefs = review.nodes.map((n) => n.ref);
  const edgeRefs = review.edges.map((e) => e.ref);
  const verdictRefs = review.verdicts.map((v) => v.ref);
  const varRefs = review.variances.map((v) => v.ref);
  const issueRefs = review.verdicts.filter((v) => v.severity >= 0.6).map((v) => v.ref);

  await io.addMessage({
    json: { kind: "story", bucket: "setup", review, refs: [...nodeRefs, ...edgeRefs], skills: routedSkills },
  });
  await emitStoryStage(io, 1, "done");
  await io.addMessage({
    json: { kind: "story", bucket: "status", review, refs: [...verdictRefs, ...varRefs], skills: routedSkills },
  });
  await emitStoryStage(io, 2, "done");
  await io.addMessage({
    markdown: out.receipts ?? "",
    json: { kind: "story", bucket: "gap", review, refs: issueRefs, skills: routedSkills },
  });
  await emitStoryStage(io, 3, "done");

  // ── Jev verification (review badge) ───────────────────────────────────────
  let verdict: any = null;
  try {
    verdict = await verifyResult({
      databaseId: io.databaseId,
      userId: io.userId,
      rawMessage,
      reply: out.reply,
      toolsUsed: out.toolsUsed,
      evidence: out.evidence,
    });
  } catch (err: any) {
    console.error("[vers_10] verify failed:", err.message);
  }
  await emitVerdictBadge(io, verdict, {
    label: "review",
    satisfies: verdict?.satisfies,
    complete: verdict?.complete,
    accurate: verdict?.accurate,
    thorough: verdict?.thorough,
  });

  // ── Story beat 5: plan (LLM-composed, Jev-verified) ───────────────────────
  const plan = await buildRemediationPlan({ databaseId: io.databaseId, review, rawMessage });
  const planRefs = Array.from(new Set(plan.actions.flatMap((a) => a.refs)));
  await io.addMessage({
    json: { kind: "story", bucket: "plan", actions: plan.actions, refs: planRefs, skills: routedSkills },
  });
  await emitStoryStage(io, 4, "done");

  let planVerdict: any = null;
  if (plan.actions.length > 0) {
    try {
      planVerdict = await verifyPlan({
        databaseId: io.databaseId,
        userId: io.userId,
        rawMessage,
        plan: plan.actions,
        findings: findingsDigest(review),
      });
    } catch (err: any) {
      console.error("[vers_10] verifyPlan failed:", err.message);
    }
    await emitVerdictBadge(io, planVerdict, {
      label: "plan",
      grounded: planVerdict?.grounded,
      actionable: planVerdict?.actionable,
    });
  }

  // ── Gate: report render needs write approval (report-only resolution) ─────
  if (hasFindings(review)) {
    await io.addMessage({
      markdown: "This plan will render an error report. Use the **Approve** button below to continue, or **Cancel**.",
      json: { approval: true },
    });
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...meta,
      pendingExecute: {
        rawMessage,
        review,
        actions: plan.actions,
        evidence: out.evidence,
        toolsUsed: out.toolsUsed,
        skills: routedSkills,
      },
    });
    console.log("[vers_10] awaiting write approval (report render).\n");
    return;
  }

  // No findings → resolve read-only (no report to render, no gate).
  await io.addMessage({
    json: { kind: "story", bucket: "resolution", review, actions: [], refs: [], skills: routedSkills },
  });
  await emitStoryStage(io, 5, "done");
  await emitStoryStage(io, 6, "done");

  console.log("[vers_10] Pipeline finished.\n");
}
