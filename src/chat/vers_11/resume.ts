/**
 * resumePlan — resolve a paused control step from a follow-up message.
 *
 * Returns true when the control step was resolved and the plan should continue
 * executing; false when the plan stays paused (wrong reply, or blocked).
 */

import { isApproval } from "../vers_9/orchestrator";
import { persistPlan } from "./executePlan";
import type { OrchestratorIO } from "../vers_9/orchestrator";
import type { TurnPlan } from "./types";

export async function resumePlan(opts: {
  plan: TurnPlan;
  rawMessage: string;
  io: OrchestratorIO;
}): Promise<boolean> {
  const step = opts.plan.steps[opts.plan.cursor];
  if (!step || step.kind !== "control") return false;

  if (step.control === "approval") {
    // A blocked approval can only be cleared by cancelling/rephrasing — never
    // by the approve phrase, so a flagged rule can't be waved through.
    if (step.status === "blocked") return false;
    if (isApproval(opts.rawMessage)) {
      step.status = "satisfied";
      opts.plan.cursor++;
      await persistPlan(opts.io, opts.plan);
      return true;
    }
    return false;
  }

  // clarify — any non-empty reply advances past the gate; the answer is already
  // in the chat history for the next compose pass to consume.
  if (step.control === "clarify") {
    if (opts.rawMessage.trim().length > 0) {
      step.status = "satisfied";
      opts.plan.cursor++;
      await persistPlan(opts.io, opts.plan);
      return true;
    }
    return false;
  }

  return false;
}
