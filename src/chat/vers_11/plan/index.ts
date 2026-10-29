/**
 * Plan module facade — the single entry point for chat planning.
 *
 * The orchestrator consumes `getPlanner()` (a swappable strategy) and the
 * deterministic arg-synthesis helpers (used by the fast path). `composePlan` /
 * `validatePlan` remain available as internal helpers for the `jev-step`
 * strategy, imported directly (not via this facade).
 */

export type { NodePlan, PlanStep, ComposeResult, ValidateResult } from "./types";
export { synthesizeStructuredArgs, resolveDataName } from "./args";
export { saveTypeFor } from "./outputs";
export type {
  PlanRequest,
  PlanResult,
  Planner,
  PlanConfidence,
  AnalysisBreadcrumb,
} from "./planner";
export { getPlanner } from "./planner";
