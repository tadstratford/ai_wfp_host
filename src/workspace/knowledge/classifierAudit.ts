import { askClassifier } from "@shared/typesafe/openRouter";
import type { Answer, NoulAnswer, Question } from "@shared/typesafe/types";
import type { SuccessFactor } from "./successFactors";

/**
 * Classifier rule audit — judge workflow rules with Jev (the TypeSafe
 * classifier) instead of a full chat LLM pass.
 *
 * Each rule becomes a `noul` question ("does the subject satisfy this rule?");
 * the verdict is a binary pass/fail computed in code from the per-rule scores
 * (mirrors the fail-closed invariant of successFactorAudit.ts: an empty or
 * malformed answer fails, it never silently passes).
 *
 * This is the classifier counterpart to `runSuccessFactorAudit` — same
 * contract (rules + subject → binary verdict), different judge model.
 */

export type ClassifierRuleVerdict = "pass" | "failed";

export interface ClassifierRuleAuditReport {
  verdict: ClassifierRuleVerdict;
  factors: { condition: string; mode: SuccessFactor["mode"]; result: "pass" | "fail" }[];
  summary: { total: number; passed: number; failed: number };
  model: string;
}

const PASS_THRESHOLD = 0.5;
const MAX_SUBJECT_CHARS = 8000;

export async function runClassifierRuleAudit(opts: {
  factors: SuccessFactor[];
  subject: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
}): Promise<ClassifierRuleAuditReport> {
  const { factors, subject, apiKey } = opts;

  const questions: Record<string, Question> = {};
  factors.forEach((f, i) => {
    questions[`rule_${i}`] = {
      type: "noul",
      instructions: `Does the subject satisfy this rule? "${f.condition}"`,
    };
  });

  const state = { subject: subject.slice(0, MAX_SUBJECT_CHARS) };

  let model = "";
  let answers: Record<string, NoulAnswer> = {};
  try {
    const { response } = await askClassifier(state, questions, {
      apiKey,
      model: opts.model,
      fetchImpl: opts.fetchImpl,
      maxAttempts: opts.maxAttempts,
      timeoutMs: opts.timeoutMs,
    });
    model = response.model || "";
    answers = (response.answers ?? {}) as Record<string, NoulAnswer>;
  } catch {
    // Fail closed — empty answers map makes every rule fail below.
    answers = {};
  }

  const audited = factors.map((f, i) => {
    const ans = answers[`rule_${i}`];
    const noul = ans && typeof ans.noul === "number" ? ans.noul : 0;
    return {
      condition: f.condition,
      mode: f.mode,
      result: noul >= PASS_THRESHOLD ? ("pass" as const) : ("fail" as const),
    };
  });

  const failed = audited.filter((a) => a.result === "fail").length;
  return {
    verdict: failed === 0 ? "pass" : "failed",
    factors: audited,
    summary: { total: audited.length, passed: audited.length - failed, failed },
    model,
  };
}

/**
 * Stream rule audit — judge a whole run stream against the workspace rules
 * (wfp.rules) and the rules presented in the workflow description, in a single
 * Jev classifier call. No LLM, no per-factor expansion.
 *
 * Violation-framed and N/A-tolerant: each workspace rule becomes its own `noul`
 * — "does the stream VIOLATE this rule?" — plus one `noul` for the presented
 * rules. A rule that does not apply to the stream scores "no violation" and
 * passes; the audit fails only when a specific rule is actually violated (and
 * names it). Fail-closed: a classifier error still fails.
 */

export type StreamAuditStatusReason =
  | "no_errors"
  | "broke_workspace_rule"
  | "broke_presented_rule"
  | "audit_unavailable";

export interface StreamRuleAuditReport {
  statusReason: StreamAuditStatusReason;
  failedRule: string | null;
  model: string;
}

/** A workspace rule as passed to the stream audit (name + full content). */
export interface StreamRule {
  name: string;
  description?: string;
  content: string;
}

const NOUL_PASS_THRESHOLD = 0.5;
const MAX_STREAM_CHARS = 16000;

export async function runStreamRuleAudit(opts: {
  workspaceRules: StreamRule[];
  presentedRules: string;
  stream: string;
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<StreamRuleAuditReport> {
  const { workspaceRules, presentedRules, stream, apiKey } = opts;

  const state = {
    workspace_rules: workspaceRules.map((r) => ({
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      content: r.content,
    })),
    presented_rules: presentedRules,
    stream: stream.slice(0, MAX_STREAM_CHARS),
  };

  const questions: Record<string, Question> = {};
  workspaceRules.forEach((r, i) => {
    questions[`rule_${i}`] = {
      type: "noul",
      instructions: `Does the stream VIOLATE workspace rule "${r.name}"? (See workspace_rules for its content.) Answer "yes" only when the rule is actually broken — a rule that does not apply to the stream is NOT a violation.`,
    };
  });
  const hasPresented = presentedRules && presentedRules.trim().length > 0;
  if (hasPresented) {
    questions.presented_violated = {
      type: "noul",
      instructions:
        "Does the stream VIOLATE any rule or requirement presented in presented_rules?",
    };
  }

  let model = "";
  const violationScores: Record<string, number> = {};
  let presentedViolation = 0;
  let classifierError = false;

  try {
    const { response } = await askClassifier(state, questions, {
      apiKey,
      model: opts.model,
      fetchImpl: opts.fetchImpl,
    });
    model = response.model || "";
    const answers = (response.answers ?? {}) as Record<string, Answer>;

    workspaceRules.forEach((r, i) => {
      const a = answers[`rule_${i}`] as NoulAnswer | undefined;
      violationScores[r.name] = a && typeof a.noul === "number" ? a.noul : 0;
    });
    const pv = answers.presented_violated as NoulAnswer | undefined;
    presentedViolation = pv && typeof pv.noul === "number" ? pv.noul : 0;
  } catch {
    classifierError = true;
  }

  // The most-violated workspace rule (at or above threshold) is the failure.
  let failedRule: string | null = null;
  let maxScore = 0;
  for (const r of workspaceRules) {
    const s = violationScores[r.name] ?? 0;
    if (s >= NOUL_PASS_THRESHOLD && s >= maxScore) {
      failedRule = r.name;
      maxScore = s;
    }
  }

  const workspaceOk = !classifierError && failedRule === null;
  const presentedOk = !classifierError && presentedViolation < NOUL_PASS_THRESHOLD;

  let statusReason: StreamAuditStatusReason;
  if (classifierError) {
    statusReason = "broke_workspace_rule";
  } else if (!workspaceOk) {
    statusReason = "broke_workspace_rule";
  } else if (hasPresented && !presentedOk) {
    statusReason = "broke_presented_rule";
  } else {
    statusReason = "no_errors";
  }

  return {
    statusReason,
    failedRule: statusReason === "no_errors" ? null : failedRule,
    model,
  };
}
