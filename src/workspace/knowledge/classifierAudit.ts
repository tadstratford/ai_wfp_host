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
 * Two `noul` questions + one `choice`:
 *   - workspace_pass: does the stream satisfy ALL workspace rules?
 *   - presented_pass: does the stream follow all rules presented in the
 *     session discussion (the workflow description)?
 *   - failed_rule:    which workspace rule failed (or "none").
 *
 * The status reason is computed in code from the two booleans (fail-closed:
 * a missing/malformed answer fails).
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

  const ruleNames = workspaceRules.map((r) => r.name);

  const state = {
    workspace_rules: workspaceRules.map((r) => ({
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      content: r.content,
    })),
    presented_rules: presentedRules,
    stream: stream.slice(0, MAX_STREAM_CHARS),
  };

  const questions: Record<string, Question> = {
    workspace_pass: {
      type: "noul",
      instructions:
        "Does the stream satisfy ALL of the workspace rules listed in workspace_rules?",
    },
    presented_pass: {
      type: "noul",
      instructions:
        "Does the stream follow all rules and requirements presented in presented_rules (the session discussion)?",
    },
    failed_rule: {
      type: "choice",
      instructions:
        "If the stream failed a workspace rule, which one? Choose the specific rule name, or 'none' if no workspace rule failed.",
      criteria: {
        none: null,
        ...Object.fromEntries(
          ruleNames.map((n) => [n, `The stream failed workspace rule "${n}".`]),
        ),
      },
    },
  };

  let model = "";
  let workspacePass = 0;
  let presentedPass = 0;
  let failedRule: string | null = null;

  try {
    const { response } = await askClassifier(state, questions, {
      apiKey,
      model: opts.model,
      fetchImpl: opts.fetchImpl,
    });
    model = response.model || "";
    const answers = (response.answers ?? {}) as Record<string, Answer>;

    const wp = answers.workspace_pass as NoulAnswer | undefined;
    const pp = answers.presented_pass as NoulAnswer | undefined;
    workspacePass = wp && typeof wp.noul === "number" ? wp.noul : 0;
    presentedPass = pp && typeof pp.noul === "number" ? pp.noul : 0;

    const fr = answers.failed_rule as
      | { choice?: string }
      | undefined;
    if (fr && typeof fr.choice === "string" && fr.choice !== "none") {
      failedRule = fr.choice;
    }
  } catch {
    // Fail closed — both booleans stay 0, status reason resolves to a failure.
    workspacePass = 0;
    presentedPass = 0;
  }

  const workspaceOk = workspacePass >= NOUL_PASS_THRESHOLD;
  const presentedOk = presentedPass >= NOUL_PASS_THRESHOLD;

  let statusReason: StreamAuditStatusReason;
  if (workspaceOk && presentedOk) {
    statusReason = "no_errors";
  } else if (!workspaceOk) {
    statusReason = "broke_workspace_rule";
  } else {
    statusReason = "broke_presented_rule";
  }

  return {
    statusReason,
    failedRule: statusReason === "no_errors" ? null : failedRule,
    model,
  };
}
