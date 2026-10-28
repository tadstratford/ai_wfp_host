/**
 * vers_10 remediation plan (storytelling step 5) — the LLM proposes an ordered
 * list of remediation actions from the deterministic review findings, each
 * referencing the `verdict-*`/`var-*`/`node-*` refs it resolves. Jev verifies the
 * plan (grounded + actionable) in the orchestrator via `verifyPlan`.
 *
 * This is read-only: actions are *recommendations*. The report-only execution
 * (step 6/7) is deterministic and lives in `resolution.ts`.
 */

import { llmCall } from "@backend/core/llm/llmCall";
import type { ReviewPayload } from "../vers_9/orchestrator";

export interface StoryAction {
  label: string;
  refs: string[];
}

/** A plain-language digest of the findings the plan is proposed against. */
export function findingsDigest(review: ReviewPayload): string {
  const lines: string[] = [];
  for (const v of review.verdicts ?? []) {
    lines.push(`- [${v.ref}] ${v.category} (${v.severity.toFixed(2)}): ${v.summary} — ${v.basis}`);
  }
  for (const v of review.variances ?? []) {
    if (Math.abs(v.diff) > 1e-6) {
      lines.push(`- [${v.ref}] ${v.key}: left ${v.left} vs right ${v.right} (diff ${v.diff})`);
    }
  }
  for (const n of review.nodes ?? []) {
    if ((n.nullColNames?.length ?? 0) > 0) {
      lines.push(`- [${n.ref}] ${n.label}: blank fields ${n.nullColNames.join(", ")}`);
    }
  }
  return lines.join("\n");
}

const VALID_REF_RE = /^(verdict|var|node|edge)-\d+$/;

/** Deterministic fallback (no LLM key): one action per non-green verdict and
 *  per variance, mapped to the review findings. */
function deterministicPlan(review: ReviewPayload): StoryAction[] {
  const actions: StoryAction[] = [];
  for (const v of review.verdicts ?? []) {
    if (v.severity >= 0.3) {
      actions.push({ label: `Resolve "${v.category}" — ${v.summary}`, refs: [v.ref] });
    }
  }
  for (const v of review.variances ?? []) {
    if (Math.abs(v.diff) > 1e-6) {
      actions.push({
        label: `Investigate the variance for "${v.key}" (${v.diff > 0 ? "+" : ""}${v.diff})`,
        refs: [v.ref],
      });
    }
  }
  return actions;
}

export async function buildRemediationPlan(opts: {
  databaseId: string;
  review: ReviewPayload;
  rawMessage: string;
}): Promise<{ actions: StoryAction[]; unavailable?: boolean }> {
  const findings = findingsDigest(opts.review);
  if (!findings) return { actions: [] };

  const systemPrompt =
    "You are proposing a remediation plan for a data-review. The findings below were " +
    "produced deterministically (no LLM wrote them). Propose an ordered list of actions " +
    "that resolve the findings. Respond with JSON only: {\"actions\":[{\"label\":\"...\",\"refs\":[\"verdict-1\"]}]}. " +
    "Rules: (1) copy entity/account names VERBATIM from the findings — never invent or rename; " +
    "(2) do not introduce any numbers not derivable from the findings; " +
    "(3) each ref must be an existing ref listed in the findings; " +
    "(4) each action is a concrete recommendation (investigate, reclassify, reconcile, re-import, re-run) — you are NOT executing it, only proposing it; " +
    "(5) order actions by materiality (red/high severity first).";

  try {
    const result = await llmCall(opts.databaseId, "chat:story-plan", {
      systemPrompt,
      messages: [{ role: "user", content: `FINDINGS:\n${findings}` }],
      maxTokens: 800,
      temperature: 0,
      responseFormat: "json",
    });
    const data = (result.data ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(data.actions) ? (data.actions as unknown[]) : [];
    const actions: StoryAction[] = raw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        label: typeof a.label === "string" ? a.label : "",
        refs: Array.isArray(a.refs)
          ? (a.refs as unknown[]).filter((r): r is string => typeof r === "string" && VALID_REF_RE.test(r))
          : [],
      }))
      .filter((a) => a.label.trim().length > 0);
    if (actions.length === 0) return { actions: deterministicPlan(opts.review) };
    return { actions };
  } catch (err: any) {
    console.warn(`[vers_10] remediation plan failed (falling back to deterministic): ${err.message}`);
    return { actions: deterministicPlan(opts.review), unavailable: true };
  }
}
