/**
 * Jev result verification — the "Jev checks the LLM's work" gate.
 *
 * vers_9 inverts vers_8's flow: the LLM plans and executes, and Jev verifies the
 * RESULT (not just the plan) for completeness and accuracy. Three `noul`s:
 *   satisfies — does the result answer what the user asked?
 *   complete  — does it cover the full scope of the request?
 *   accurate  — is it internally consistent AND consistent with the computed
 *               evidence (the aggregate/check figures the tools returned)?
 *
 * The `evidence` input is what makes "accurate" a real check rather than a
 * plausibility heuristic: it carries the structured output of the deterministic
 * tools the loop ran (aggregate_data, check_data, judge_data, compare_data), so
 * Jev can cross-check the prose against the numbers that were actually computed
 * instead of guessing from prose alone.
 *
 * Fail-closed: when Jev can't run (no classifier key) or the verdict is below
 * the gates, the orchestrator surfaces a visible warning instead of silently
 * accepting the LLM's output.
 */

import { askClassifier } from "@shared/typesafe/openRouter";
import type { NoulAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";

export interface VerifyResult {
  satisfies: number;
  complete: number;
  accurate: number;
  /** True when every score meets its gate. */
  pass: boolean;
  /** Short human-readable reason, only when the verdict fails. */
  reason?: string;
}

export interface VerifyInput {
  databaseId: string;
  userId: string;
  rawMessage: string;
  /** The final assistant reply (or empty when the loop produced no prose). */
  reply: string;
  /** The ordered tool names the LLM called (for completeness context). */
  toolsUsed: string[];
  /** Structured output of the deterministic tools the loop ran, used as the
   *  ground truth the prose is checked against (already privacy-masked). */
  evidence?: { tool: string; summary: string }[];
  /** Optional gate thresholds (0..1). */
  satisfiesGate?: number;
  completeGate?: number;
  accurateGate?: number;
}

export async function verifyResult(input: VerifyInput): Promise<VerifyResult | null> {
  const satisfiesGate = input.satisfiesGate ?? 0.6;
  const completeGate = input.completeGate ?? 0.6;
  const accurateGate = input.accurateGate ?? 0.6;

  let key: string;
  try {
    key = await getClassifierKey(input.userId);
  } catch {
    return null; // no classifier key — caller handles the null as "unavailable"
  }

  // Privacy-mask user-derived text before it leaves the machine (same packs as
  // the LLM path). The evidence is tool output already privacy-masked by the
  // producing tools, so it is passed through as-is.
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

  const questions: Record<string, Question> = {
    satisfies: {
      type: "noul",
      instructions: "Does the result fully satisfy the user's request?",
    },
    complete: {
      type: "noul",
      instructions:
        "Does the result cover the full scope of the user's request — every substantive part addressed, with no important part left out or stopping prematurely?",
    },
    accurate: {
      type: "noul",
      instructions:
        "Is the result internally consistent and consistent with the computed_evidence — no internal contradictions, no figures that conflict with the evidence, no unsupported claims or invented values?",
    },
  };

  const { response } = await askClassifier(state, questions, { apiKey: key });
  const satisfies = (response.answers.satisfies as NoulAnswer).noul;
  const complete = (response.answers.complete as NoulAnswer).noul;
  const accurate = (response.answers.accurate as NoulAnswer).noul;

  const pass = satisfies >= satisfiesGate && complete >= completeGate && accurate >= accurateGate;
  const reason = pass
    ? undefined
    : `satisfies ${satisfies.toFixed(2)}, complete ${complete.toFixed(2)}, accurate ${accurate.toFixed(2)}`;

  return { satisfies, complete, accurate, pass, reason };
}
