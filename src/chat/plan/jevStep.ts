/**
 * jev-step planner — the original strategy: Jev picks tools one step at a time
 * (`composePlan`), then Jev validates (`validatePlan`). Kept as the baseline so
 * the newer strategies can be A/B compared against it.
 */

import type { Planner, PlanRequest, PlanResult } from "./planner";
import { composePlan } from "./compose";
import { validatePlan } from "./validate";

export const jevStepPlanner: Planner = {
  id: "jev-step",
  async plan(req: PlanRequest): Promise<PlanResult> {
    const composed = await composePlan({
      databaseId: req.databaseId,
      userId: req.userId,
      rawMessage: req.rawMessage,
      tools: req.tools,
      lastRequest: req.lastRequest,
      activeSkills: req.activeSkills,
    });

    if (composed.plan.steps.length === 0) {
      return { kind: "fallback", reason: "compose produced no steps", log: composed.log };
    }

    const verdict = await validatePlan({
      databaseId: req.databaseId,
      userId: req.userId,
      rawMessage: req.rawMessage,
      plan: composed.plan,
      missingRequired: composed.missingRequired,
    });

    if (!verdict.pass) {
      return { kind: "fallback", reason: verdict.reason ?? "plan rejected", log: composed.log };
    }

    return {
      kind: "plan",
      plan: composed.plan,
      missingRequired: composed.missingRequired,
      confidence: { satisfies: verdict.score },
    };
  },
};
