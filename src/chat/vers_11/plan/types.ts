/**
 * Node-plan types — the chat-side representation of a workflow to run.
 *
 * A `NodePlan` is an ordered list of `PlanStep`s. Each step names a pre-built
 * tool (`tool_id`) and its resolved arguments (`tool_parameters`, which may
 * reference prior outputs as `{{name}}`). The plan is what Jev composes and
 * validates, and what the workflow executor runs in the chat session.
 */

export interface PlanStep {
  /** Pre-built tool id (native or MCP), e.g. "get_data", "qbo_actuals_flat". */
  tool_id: string;
  /** Resolved arguments. Values may be literals or `{{name}}` references. */
  tool_parameters: Record<string, unknown>;
  /** Human-readable label for progress/audit output. */
  label: string;
}

export interface NodePlan {
  /** Ordered steps to execute. */
  steps: PlanStep[];
}

/** A compose run's structured outcome, for traceability and gating. */
export interface ComposeResult {
  plan: NodePlan;
  /** Human-readable trace of what was selected and why. */
  log: string[];
  /** Required tool arguments that could not be resolved from the request. */
  missingRequired: string[];
}

/** A Jev validation verdict over a composed plan. */
export interface ValidateResult {
  /** True when the plan passes the validation gate and may run. */
  pass: boolean;
  /** 0..1 — how well the plan satisfies the request. */
  score: number;
  /** Short human-readable reason, surfaced when the plan is rejected. */
  reason?: string;
}
