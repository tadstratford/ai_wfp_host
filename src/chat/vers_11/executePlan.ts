/**
 * executePlan — walk the materialized plan, executing each typed step.
 *
 *   data          → run the tool, emit a `step-status` checklist update, record
 *                   evidence, interpret a rule-check flag
 *   communication → emit the message
 *   control       → surface the gate and PAUSE (persist cursor, return)
 *
 * The `approval` control step is BLOCKED when any prior rule-check data step
 * flagged — the plan refuses to proceed until the user cancels or rephrases.
 *
 * On completion, a review-shaped plan renders its deterministic review report
 * (v9's `buildReview`/`renderReviewReport`) and the per-rule check summary.
 */

import { aggregator } from "../../mcp/aggregator";
import { resolveTemplates, setParameterValue } from "@backend/core/settings/parameterHelpers";
import { getSession, updateSession } from "@backend/core/session/sessions/session_all";
import type { OrchestratorIO } from "../vers_9/orchestrator";
import { buildReview, renderReviewReport, reconcileReviewEvidence } from "../vers_9/orchestrator";
import type { DataStep, EvidenceItem, RuleTier, TurnPlan } from "./types";

const VERIFIABLE_TOOLS = new Set([
  "aggregate_data", "check_data", "judge_data", "compare_data",
  "reconcile_relationship", "profile_data", "classify_data", "split_data",
]);

function extractTextContent(mcpResult: any): string {
  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    return mcpResult.content.map((c: any) => c.text || "").filter(Boolean).join("\n");
  }
  if (typeof mcpResult === "string") return mcpResult;
  return JSON.stringify(mcpResult);
}

function parseToolOutput(text: string): unknown {
  if (!text) return text;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.parse(t); } catch { return text; }
  }
  return text;
}

/** Persist the plan (cursor + step statuses) and, when given, the session
 *  parameters — so a `{{result}}` written before a paused control step resolves
 *  correctly when execution resumes on the next turn. */
export async function persistPlan(io: OrchestratorIO, plan: TurnPlan, parameters?: any): Promise<void> {
  try {
    const fresh = await getSession(io.databaseId, io.sessionId);
    if (!fresh) return;
    await updateSession(io.databaseId, io.sessionId, "metadata", {
      ...(fresh.metadata ?? {}),
      plan,
    });
    if (parameters !== undefined) {
      await updateSession(io.databaseId, io.sessionId, "parameters", parameters);
    }
  } catch (err: any) {
    console.error("[vers_11] persistPlan failed:", err.message);
  }
}

/** The up-front plan card — a numbered checklist of the plan's data steps,
 *  rendered in the right panel and updated live by `step-status` messages. */
export async function emitPlanMessage(io: OrchestratorIO, plan: TurnPlan): Promise<void> {
  const dataSteps = plan.steps.filter((s): s is DataStep => s.kind === "data");
  if (dataSteps.length === 0) return;
  const steps = dataSteps.map((s) => ({ label: s.label, tool_id: s.tool }));
  const stepList = steps.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
  await io.addMessage({
    markdown: `**Steps**\n${stepList}`,
    json: { kind: "plan", planId: plan.id, steps },
  });
}

/** Interpret a rule-check tool's output into a done/flag status. Deterministic:
 *  a reconcile with mismatches/orphans, or a check_data with any noul ≥ 0.6, flags. */
export function interpretRuleCheck(tier: RuleTier | undefined, output: string): "done" | "flag" {
  if (!tier) return "done";
  try {
    const p = JSON.parse(output);
    if (!p || typeof p !== "object") return "done";
    const arr = Array.isArray(p) ? p : [p];
    const nouls = arr.filter((x: any) => typeof x?.noul === "number").map((x: any) => x.noul);
    if (nouls.length > 0) {
      return nouls.some((n) => n >= 0.6) ? "flag" : "done";
    }
    const summ = (arr[0] as any)?.summary ?? {};
    const mismatched = Number(summ.mismatched ?? 0);
    const missing = Number(summ.missing_left ?? 0) + Number(summ.missing_right ?? 0);
    if (mismatched > 0 || missing > 0) return "flag";
  } catch {
    // non-JSON output — not interpretable, treat as done
  }
  return "done";
}

function flaggedRules(plan: TurnPlan): DataStep[] {
  return plan.steps.filter(
    (s): s is DataStep => s.kind === "data" && s.ruleCheck !== undefined && s.status === "flag",
  );
}

/** The per-rule enforcement summary, rendered from the plan's rule-check statuses. */
function renderRuleReport(plan: TurnPlan): string {
  const lines: string[] = [];
  for (const s of plan.steps) {
    if (s.kind !== "data" || !s.ruleCheck) continue;
    if (s.status === "flag") {
      lines.push(`⚠ \`${s.ruleCheck}\` — flagged by ${s.tool}`);
    } else if (s.status === "done") {
      const prefix = s.tier === "classified" ? "classified by" : "checked with";
      lines.push(`✓ \`${s.ruleCheck}\` — ${prefix} ${s.tool}`);
    } else {
      lines.push(`⚠ \`${s.ruleCheck}\` — not proven`);
    }
  }
  return lines.length > 0 ? `**Rule check**\n${lines.join("\n")}` : "";
}

export interface ExecuteOutcome {
  evidence: EvidenceItem[];
  toolsUsed: string[];
  /** True when execution paused at a control step (awaiting the user). */
  paused: boolean;
}

export async function executePlan(opts: {
  plan: TurnPlan;
  io: OrchestratorIO;
  session: any;
  rawMessage: string;
  reviewShaped: boolean;
}): Promise<ExecuteOutcome> {
  const evidence: EvidenceItem[] = [];
  const toolsUsed: string[] = [];
  const { plan, io, session } = opts;
  let relationshipsOutput: unknown = null;
  let dataIndex = 0;

  while (plan.cursor < plan.steps.length) {
    const step = plan.steps[plan.cursor];

    if (step.kind === "communication") {
      step.status = "done";
      await io.addMessage(step.message);
      plan.cursor++;
      continue;
    }

    if (step.kind === "control") {
      if (step.control === "approval") {
        const flagged = flaggedRules(plan);
        if (flagged.length > 0) {
          step.status = "blocked";
          await io.addMessage({
            markdown:
              `⚠ Rule checks flagged before this write:\n` +
              flagged.map((f) => `- \`${f.ruleCheck}\``).join("\n") +
              `\nThe write is blocked. Rephrase the request or fix the underlying data, then try again.`,
            json: { kind: "rule-blocked", rules: flagged.map((f) => f.ruleCheck) },
          });
        } else {
          await io.addMessage({
            markdown: step.prompt ?? "Approve to continue.",
            json: { approval: true, planId: plan.id },
          });
        }
      } else {
        await io.addMessage({
          markdown: step.prompt ?? "Clarification needed.",
          json: { kind: "clarify", planId: plan.id },
        });
      }
      await persistPlan(io, plan, session.parameters);
      return { evidence, toolsUsed, paused: true };
    }

    // data step
    step.status = "running";
    await io.addMessage({
      markdown: step.label,
      json: { kind: "step-status", index: dataIndex, status: "running", label: step.label },
    });
    try {
      const resolved = resolveTemplates(step.args, session.parameters, io.databaseId) as Record<string, unknown>;
      const mcpResult = await aggregator.callTool(step.tool, resolved);
      const full = extractTextContent(mcpResult);
      if (VERIFIABLE_TOOLS.has(step.tool)) evidence.push({ tool: step.tool, summary: full.slice(0, 2500) });
      toolsUsed.push(step.tool);
      const resultValue = parseToolOutput(full);
      if (step.tool === "list_relationships") relationshipsOutput = resultValue;
      session.parameters = setParameterValue(session.parameters, "result", {
        _meta: { type: "text" },
        data: resultValue,
      });
      step.status = step.ruleCheck ? interpretRuleCheck(step.tier, full) : "done";
    } catch (err: any) {
      console.error(`[vers_11] step ${step.tool} error:`, err.message);
      step.status = "error";
    }
    await io.addMessage({
      markdown: step.label,
      json: { kind: "step-status", index: dataIndex, status: step.status, label: step.label },
    });
    dataIndex++;
    await persistPlan(io, plan, session.parameters);
    plan.cursor++;
  }

  // ── Finalize: review report (review-shaped) + rule-check summary ──────────
  if (opts.reviewShaped) {
    // Dynamic reconcile + aggregate diff — the valuation/agreement evidence the
    // battery alone doesn't produce (reuses v9's reconciliation phase).
    const reconciled = await reconcileReviewEvidence({
      databaseId: io.databaseId,
      session,
      evidence,
      relationshipsOutput,
    });
    const reviewEvidence = reconciled.evidence;
    const built = buildReview(reviewEvidence, relationshipsOutput, opts.rawMessage);
    if (built) {
      await io.addMessage({
        markdown: built.receipts,
        json: { kind: "review", review: built.payload, skills: plan.provenance.skills },
      });
    } else {
      const fallback = renderReviewReport(reviewEvidence, relationshipsOutput, opts.rawMessage);
      await io.addMessage({ markdown: fallback, json: { kind: "reply", skills: plan.provenance.skills } });
    }
    if (reconciled.pendingClarify.length > 0) {
      const menu = reconciled.pendingClarify
        .map((p) => `${p.index + 1}. \`${p.leftShort}\` ↔ \`${p.rightShort}\``)
        .join("\n");
      await io.addMessage({
        markdown: `I found several tables that could be reconciled. Reply with the number of the pair:\n\n${menu}`,
        json: { kind: "meta" },
      });
    }
  }

  const ruleReport = renderRuleReport(plan);
  if (ruleReport) {
    await io.addMessage({ markdown: ruleReport, json: { kind: "rule-check" } });
  }

  await persistPlan(io, plan, session.parameters);

  return { evidence, toolsUsed, paused: false };
}
