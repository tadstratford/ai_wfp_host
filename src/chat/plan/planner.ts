/**
 * Planner — the single, swappable unit that turns a routed chat request into an
 * ordered, validated plan (or a fallback signal).
 *
 * The orchestrator only knows about this interface: it asks `getPlanner()` for
 * a planner and calls `plan(request)`. Swapping `CHAT_PLANNER` (or the `id`
 * argument) swaps the whole planning strategy — Jev step-by-step (`jev-step`),
 * the shape→template cascade (`cascade`), or a full-LLM planner (`llm`) — so the
 * three can be A/B compared without touching the orchestrator.
 */

import type { NodePlan } from "./types";
import { jevStepPlanner } from "./jevStep";
import { cascadePlanner } from "./cascade";
import { llmPlanner } from "./llm";

/** A breadcrumb of the previous turn's analysis, so a follow-up ("make a report
 *  of these findings") can reuse the same data source and saved summary instead
 *  of re-picking and re-aggregating. */
export interface AnalysisBreadcrumb {
  rawMessage: string;
  /** Primary data file the prior turn read. */
  source: string;
  /** The staging_* / saved table the prior turn wrote (if any). */
  savedSummary?: string;
  /** The columns the prior turn aggregated by (so a follow-up report joins on the same keys). */
  groupBy?: string[];
  at: string;
}

/** Everything a planner needs to produce a plan. Assembled by the orchestrator
 *  after routing (skill selection + tool roster + gates). */
export interface PlanRequest {
  databaseId: string;
  userId: string;
  rawMessage: string;
  /** Candidate components (name + description). The orchestrator passes the
   *  narrow "composable primitives + skills' declared tools" roster. */
  tools: { name: string; description: string }[];
  /** Active skill names (post-routing), for skill-aware planning. */
  activeSkills: string[];
  /** Prior-turn request text, for follow-up continuity. */
  lastRequest?: string;
  /** Rolling history of recent analyses (most recent first), for follow-up reuse. */
  analysisHistory?: AnalysisBreadcrumb[];
  /** Jev complexity score (0..1) from routing. */
  complexity: number;
  /** Jev mutating score (0..1) from routing. */
  mutating: number;
  /** Values already resolved and stored in session.parameters (e.g. from a
   *  clarification answer), keyed by bare param name. The extractor uses these
   *  as a fallback when the request text doesn't resolve an argument — the same
   *  consume-by-name convention the workflow's pause form uses. */
  clarifiedParams?: Record<string, unknown>;
}

/** Calibrated confidence from a plan's internal validation (for future
 *  confidence-escrow tuning). Both optional — not every strategy computes both. */
export interface PlanConfidence {
  satisfies?: number;
  safe?: number;
}

/** A planner's verdict. `plan` means the orchestrator may show the steps and
 *  execute; `fallback` means the orchestrator should defer to the LLM loop;
 *  `clarify` means a required parameter could not be resolved and the chat
 *  should ask the user for it instead of guessing. */
export type PlanResult =
  | {
      kind: "plan";
      plan: NodePlan;
      missingRequired: string[];
      confidence?: PlanConfidence;
    }
  | {
      kind: "fallback";
      reason: string;
      log?: string[];
      /** When true, skip the LLM planner and defer straight to the build loop
       *  (for generative work — bespoke reports/dashboards — that a one-shot
       *  plan can't express). */
      preferLoop?: boolean;
    }
  | {
      kind: "clarify";
      /** Unresolved required arguments, in `toolId.param` form. */
      missing: string[];
      /** Optional human question. When absent, the orchestrator builds a generic
       *  question from the missing params' schemas. */
      question?: string;
    };

export interface Planner {
  readonly id: string;
  plan(req: PlanRequest): Promise<PlanResult>;
}

const registry: Record<string, Planner> = {
  "jev-step": jevStepPlanner,
  cascade: cascadePlanner,
  llm: llmPlanner,
};

/** Resolve the active planner. Selectable via `CHAT_PLANNER` (defaults to
 *  `cascade`). Throws on an unknown id — no silent fallback. */
export function getPlanner(id?: string): Planner {
  const key = (id ?? process.env.CHAT_PLANNER ?? "cascade").toLowerCase();
  const planner = registry[key];
  if (!planner) {
    throw new Error(
      `Unknown planner "${key}". Expected "jev-step", "cascade", or "llm".`,
    );
  }
  return planner;
}
