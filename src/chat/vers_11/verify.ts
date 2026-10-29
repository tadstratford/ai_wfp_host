/**
 * vers_11 verification — the LLM checks the turn's reply against the computed
 * evidence before it is trusted.
 *
 * The LLM is the verifier (not Jev): it reasons over the reply + the structured
 * output of the deterministic tools that ran, and reports pass/fail with concrete
 * issues. A failed verdict persists `metadata.pendingVerify` so a follow-up can
 * address the gaps.
 */

import { z } from "zod";
import { callStructured } from "@backend/core/llm/structured";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import { loadConfig } from "./config";
import type { EvidenceItem } from "./types";

export interface VerifyVerdict {
  pass: boolean;
  satisfies: number;
  complete: number;
  accurate: number;
  thorough: number;
  reason?: string;
  issues?: string[];
}

const VerifySchema = z.object({
  pass: z.boolean(),
  satisfies: z.number().min(0).max(1),
  complete: z.number().min(0).max(1),
  accurate: z.number().min(0).max(1),
  thorough: z.number().min(0).max(1),
  reason: z.string().optional(),
  issues: z.array(z.string()).optional(),
});

const VERIFY_SYSTEM =
  "You verify an AI assistant's final answer against the computed evidence. " +
  "Return ONLY structured JSON: {pass, satisfies, complete, accurate, thorough, reason?, issues?}. " +
  '"satisfies" = does the answer do what the user asked; "complete" = no part of the request left out; ' +
  '"accurate" = internally consistent AND consistent with the computed_evidence (no invented names/figures, nothing that contradicts the evidence); ' +
  '"thorough" = did it cover the standard review dimensions rather than only the named items. ' +
  'Set pass=false and list "issues" (one concrete problem each) when anything is invented, contradicts evidence, is inconsistent, or is incomplete. ' +
  "Do not introduce new facts — only judge what is shown.";

export interface VerifyInput {
  databaseId: string;
  userId: string;
  rawMessage: string;
  reply: string;
  toolsUsed: string[];
  evidence: EvidenceItem[];
}

/** The LLM verification gate. Returns null (fail-closed) when the model can't
 *  produce a schema-conforming verdict — the caller surfaces "unavailable". */
export async function verifyResultLlm(input: VerifyInput): Promise<VerifyVerdict | null> {
  const cfg = loadConfig();
  if (!cfg.verify.enabled) return null;

  let privacyMap = loadPrivacyMap(input.databaseId);
  const probe = {
    system: "",
    messages: [
      { role: "user", content: input.rawMessage },
      { role: "user", content: input.reply },
    ],
  };
  const { added } = discoverRequestValues(input.databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(input.databaseId);

  const evidence = (input.evidence ?? []).map((e) => `[${e.tool}] ${e.summary}`);

  const state = {
    request: privacyMap ? maskText(input.rawMessage, privacyMap) : input.rawMessage,
    result: privacyMap ? maskText(input.reply, privacyMap) : input.reply,
    tools_used: input.toolsUsed,
    computed_evidence: evidence,
  };

  return await callStructured<VerifyVerdict>({
    databaseId: input.databaseId,
    schema: VerifySchema,
    toolName: "emit_verdict",
    toolDescription: "Emit the verification verdict as structured JSON.",
    system: VERIFY_SYSTEM,
    userMessage: JSON.stringify(state, null, 2),
    maxTokens: 1500,
    temperature: cfg.llm.temperature,
    callOpts: { userId: input.userId, mode: "chat", phase: "verify" },
  });
}

/** Whether a turn should be verified at all. Deterministic read/report turns with
 *  no prose and no write have nothing to cross-check; reviews, writes, and any
 *  LLM-authored reply do. */
export function shouldVerify(opts: { reviewShaped: boolean; mutating: boolean; hasLlmAuthored: boolean }): boolean {
  return opts.reviewShaped || opts.mutating || opts.hasLlmAuthored;
}

/** True when the verdict passes every gate (from config). */
export function verdictPasses(verdict: VerifyVerdict): boolean {
  const g = loadConfig().verify.gates;
  return (
    verdict.satisfies >= g.satisfies &&
    verdict.complete >= g.complete &&
    verdict.accurate >= g.accurate &&
    verdict.thorough >= g.thorough
  );
}
