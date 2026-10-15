/**
 * Success Factor Audit — Glass Box slice 2 (see docs/glass-box-spec.md)
 *
 * The machine audit: given a knowledge pack's success factors and a subject (the
 * data/output a workflow produced), run ONE independent LLM audit pass that judges
 * every factor, then compute a BINARY verdict — PASS or NEEDS REVIEW — in code.
 *
 * Design invariants:
 * - The verdict is binary, never a confidence score (see feedback_no_confidence_scores).
 *   The model returns per-factor pass/fail; this module ANDs them together.
 * - The audit is a separate, independent step from whatever produced the subject —
 *   that independence is what makes it an audit, not self-grading.
 * - Fail-safe: if the auditor's output is malformed or incomplete, the affected
 *   factors default to FAIL → NEEDS REVIEW. Ambiguity routes to a human; it never
 *   silently passes (see feedback_no_fallbacks_no_nlp).
 */

import type { LLMCallOptions, LLMCallResult } from "@backend/core/llm/llm-client";
import type { SuccessFactor, SuccessFactorMode } from "./successFactors";

export type AuditVerdict = "pass" | "failed";

export interface FactorAudit {
  condition: string;
  mode: SuccessFactorMode;
  result: "pass" | "fail";
  /** What specifically failed (empty on pass). */
  signal: string;
  /** The concrete next action when failed (empty on pass). */
  remedy: string;
}

export interface AuditReport {
  verdict: AuditVerdict;
  factors: FactorAudit[];
  summary: { total: number; passed: number; failed: number };
  /** Model that ran the audit pass — recorded for the audit path / model-independence. */
  model: string;
}

/** Subject text is capped so a large dataset can't blow the prompt budget. */
const MAX_SUBJECT_CHARS = 8000;

const AUDITOR_SYSTEM_PROMPT =
  `You are an INDEPENDENT machine auditor for a financial workflow system. You did NOT ` +
  `produce the subject below — your only job is to verify it against a knowledge pack's ` +
  `success factors, the way a reviewer checks someone else's work.\n\n` +
  `You receive a numbered list of success factors and a SUBJECT (data or output to check). ` +
  `For EACH factor decide whether the SUBJECT satisfies it:\n` +
  `- "pass" — the subject clearly and verifiably satisfies the factor.\n` +
  `- "fail" — the subject violates the factor, OR does not contain enough information to ` +
  `confirm it. Do NOT give the benefit of the doubt; unconfirmed means fail.\n\n` +
  `Factors tagged [deterministic] are objective and must be strictly, checkably true. ` +
  `Factors tagged [audit] require judgment but must still be supported by the subject.\n\n` +
  `For every "fail" provide:\n` +
  `- "signal": the specific thing that failed; cite the offending row/value/account where ` +
  `possible. One sentence.\n` +
  `- "remedy": the concrete next action a person should take. One sentence.\n` +
  `On "pass", leave "signal" and "remedy" as empty strings.\n\n` +
  `Respond with STRICT JSON only, no prose, no code fence:\n` +
  `{"results":[{"index":<number>,"result":"pass"|"fail","signal":"","remedy":""}]}\n` +
  `Return exactly one entry per factor, using the factor's number as "index".`;

function buildUserContent(factors: SuccessFactor[], subject: string, subjectLabel: string): string {
  // 1-based numbering: models reliably 1-index a list even when told otherwise;
  // the reader below tolerates either base, so this just removes a common off-by-one.
  const list = factors
    .map((f, i) => `${i + 1}. [${f.mode}] ${f.condition}`)
    .join("\n");
  const trimmed =
    subject.length > MAX_SUBJECT_CHARS
      ? subject.slice(0, MAX_SUBJECT_CHARS) + "\n... (truncated)"
      : subject;
  return `## Success Factors\n${list}\n\n## Subject: ${subjectLabel}\n\n${trimmed}`;
}

/**
 * Run the audit. Assumes `factors` is non-empty (callers guard with
 * hasSuccessFactors). Always resolves to a report — LLM failures surface as
 * NEEDS REVIEW rather than throwing, so a workflow never proceeds on a silent pass.
 */
export async function runSuccessFactorAudit(opts: {
  factors: SuccessFactor[];
  subject: string;
  callLLM: (source: string, o: LLMCallOptions) => Promise<LLMCallResult>;
  subjectLabel?: string;
}): Promise<AuditReport> {
  const { factors, subject, callLLM } = opts;
  const subjectLabel = opts.subjectLabel || "output";

  let resultsByIndex = new Map<number, { result: string; signal?: string; remedy?: string }>();
  let model = "";
  try {
    const res = await callLLM("chat:kb-audit", {
      systemPrompt: AUDITOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserContent(factors, subject, subjectLabel) }],
      temperature: 0,
      maxTokens: 2048,
      responseFormat: "json",
    });
    model = res.model || "";
    const rows = Array.isArray(res.data?.results) ? res.data.results : [];
    for (const r of rows) {
      if (r && typeof r.index === "number") {
        resultsByIndex.set(r.index, {
          result: String(r.result ?? "").toLowerCase(),
          signal: typeof r.signal === "string" ? r.signal.trim() : "",
          remedy: typeof r.remedy === "string" ? r.remedy.trim() : "",
        });
      }
    }
  } catch {
    // Leave resultsByIndex empty → every factor fails closed below.
    resultsByIndex = new Map();
  }

  // Detect whether the model indexed 0-based or 1-based and map consistently.
  // (A per-factor `get(i+1) ?? get(i)` would mis-shift genuine 0-based results,
  // since factor 0 would grab index 1.) If index 0 is present it's 0-based;
  // otherwise assume the prompt's 1-based numbering.
  const indexOffset = resultsByIndex.has(0) ? 0 : 1;

  const audited: FactorAudit[] = factors.map((f, i) => {
    const r = resultsByIndex.get(i + indexOffset);
    if (r && r.result === "pass") {
      return { condition: f.condition, mode: f.mode, result: "pass", signal: "", remedy: "" };
    }
    // Explicit fail, or a missing/ambiguous verdict → fail closed.
    if (r && r.result === "fail") {
      return {
        condition: f.condition,
        mode: f.mode,
        result: "fail",
        signal: r.signal || "Factor not satisfied by the subject.",
        remedy: r.remedy || "Review this factor against the data manually.",
      };
    }
    return {
      condition: f.condition,
      mode: f.mode,
      result: "fail",
      signal: "The auditor did not return a clear verdict for this factor.",
      remedy: "Re-run the audit or review this factor manually.",
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

/** Render the report as a run-log message body (the Glass Box reads the same data). */
export function formatAuditMarkdown(
  report: AuditReport,
  opts?: { packName?: string; subjectLabel?: string },
): string {
  const pass = report.verdict === "pass";
  const header = pass ? "## Machine Audit: PASS" : "## Machine Audit: FAILED AUDIT";
  const ctx = [
    opts?.packName ? `Pack: \`${opts.packName}\`` : null,
    opts?.subjectLabel ? `Subject: \`${opts.subjectLabel}\`` : null,
    `${report.summary.total} factor${report.summary.total === 1 ? "" : "s"} checked`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (pass) {
    return `${header}\n\n${ctx}\n\nAll success factors are satisfied. No review needed.`;
  }

  const failedBlocks = report.factors
    .filter((f) => f.result === "fail")
    .map(
      (f) =>
        `- ${f.condition} _[${f.mode}]_\n  - **Signal:** ${f.signal}\n  - **Remedy:** ${f.remedy}`,
    )
    .join("\n");

  return (
    `${header}\n\n${ctx}\n\n` +
    `**Failed audit (${report.summary.failed} of ${report.summary.total}):**\n${failedBlocks}`
  );
}
