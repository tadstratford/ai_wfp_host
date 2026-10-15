/**
 * Node-plan validator — Jev gates the composed plan before execution.
 *
 * Two `noul` questions: does the plan satisfy the request, and is it safe to
 * run (no missing required data, no invalid steps)? Fails closed.
 */

import { askClassifier } from "@shared/typesafe/openRouter";
import type { NoulAnswer, Question } from "@shared/typesafe/types";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText, discoverRequestValues } from "@backend/core/knowledge/autoMask";
import type { NodePlan, ValidateResult } from "./types";

export interface ValidateOptions {
  databaseId: string;
  userId: string;
  rawMessage: string;
  plan: NodePlan;
  /** Required tool arguments the composer could not resolve. */
  missingRequired?: string[];
  /** Gate thresholds (0..1). */
  satisfiesGate?: number;
  safeGate?: number;
}

/** Serialize the plan for Jev's state. */
function planToState(plan: NodePlan): string {
  return plan.steps
    .map((s, i) => `${i + 1}. ${s.tool_id}(${JSON.stringify(s.tool_parameters)})`)
    .join("\n");
}

export async function validatePlan(opts: ValidateOptions): Promise<ValidateResult> {
  const satisfiesGate = opts.satisfiesGate ?? 0.5;
  const safeGate = opts.safeGate ?? 0.5;

  // Hard, deterministic rejection: a plan that can't fill a required argument
  // must not run, regardless of Jev's verdict.
  if (opts.missingRequired && opts.missingRequired.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: `Missing required input(s): ${opts.missingRequired.join(", ")}.`,
    };
  }
  if (opts.plan.steps.length === 0) {
    return { pass: false, score: 0, reason: "The plan has no steps." };
  }

  let privacyMap = loadPrivacyMap(opts.databaseId);
  const probe = {
    system: "",
    messages: [{ role: "user", content: opts.rawMessage }],
  };
  const { added } = discoverRequestValues(opts.databaseId, probe);
  if (added > 0) privacyMap = loadPrivacyMap(opts.databaseId);

  const state = {
    request: privacyMap ? maskText(opts.rawMessage, privacyMap) : opts.rawMessage,
    plan: planToState(opts.plan),
  };

  const questions: Record<string, Question> = {
    satisfies: {
      type: "noul",
      instructions:
        "Does this plan fully satisfy the user's request, producing the outcome they asked for?",
    },
    safe: {
      type: "noul",
      instructions:
        "Is this plan safe to run as-is — every step has the data it needs and no step is invalid or missing a required input?",
    },
  };

  const key = await getClassifierKey(opts.userId);
  const { response } = await askClassifier(state, questions, { apiKey: key });

  const satisfies = (response.answers.satisfies as NoulAnswer).noul;
  const safe = (response.answers.safe as NoulAnswer).noul;

  const pass = satisfies >= satisfiesGate && safe >= safeGate;
  return {
    pass,
    score: satisfies,
    reason: pass
      ? undefined
      : `Plan rejected (satisfies ${satisfies.toFixed(2)}, safe ${safe.toFixed(2)}).`,
  };
}
