/**
 * vers_11 types — the rule layer + the materialized plan.
 *
 * A `TurnPlan` is the single object vers_11 builds, executes, and maintains
 * across turns. Every step is one of three kinds:
 *   - data           run a tool with parameters (the operational plane)
 *   - communication  emit a message (the presentation plane)
 *   - control        a gate (approval / clarify) — the "maintain" anchor
 *
 * The plan is small by design: steps carry tool names + arguments + a status,
 * never the data itself. Evidence lives in the workspace (session.parameters,
 * metadata.lastEvidence), not in the plan.
 */

import type { AddMessageArgs } from "@backend/types/chat";

export interface SelectedRule {
  name: string;
  description?: string;
  /** Full markdown body — loaded only after selection, never in the routing prompt. */
  content: string;
  /** Relevance score from the description-level Jev choice (0..1). */
  prob: number;
}

export type RuleTier = "deterministic" | "classified" | "audit";

export interface ClassifiedRule {
  rule: SelectedRule;
  tier: RuleTier;
  /** The tool that verifies this rule (deterministic/classified tiers only). */
  tool?: string;
  /** Why this tier was chosen (keyword → tool mapping). */
  reason: string;
}

/** A slice of deterministic-tool output used to decide enforcement coverage. */
export interface EvidenceItem {
  tool: string;
  summary: string;
}

/** Sensitivity levers for the Jev funnel, read from env (see .env.example). */
export interface SelectionConfig {
  tagThreshold: number;
  probThreshold: number;
  maxRules: number;
  maxTags: number;
  maxCandidates: number;
}

// ── The materialized plan ────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "flag" | "error" | "satisfied" | "blocked";

export interface DataStep {
  kind: "data";
  tool: string;
  args: Record<string, unknown>;
  label: string;
  /** Durable, reusable workflow step (recorded for "save as workflow"). */
  durable?: boolean;
  /** Rule name when this step is a rule-enforcement check (drives the gate). */
  ruleCheck?: string;
  tier?: RuleTier;
  status: StepStatus;
}

export interface CommunicationStep {
  kind: "communication";
  message: AddMessageArgs;
  /** Story beat name, when this message is part of a narrative. */
  stage?: string;
  status: StepStatus;
}

export interface ControlStep {
  kind: "control";
  control: "approval" | "clarify";
  prompt?: string;
  /** Unresolved required args (`toolId.param`) when this is a clarify gate. */
  missing?: string[];
  status: StepStatus;
}

export type Step = DataStep | CommunicationStep | ControlStep;

export interface TurnPlan {
  id: string;
  steps: Step[];
  /** Index of the next step to execute — the "maintain" anchor. */
  cursor: number;
  provenance: { skills: string[]; rules: SelectedRule[] };
  createdAt: string;
}

/** A rule whose check could not be composed into a deterministic/classified step. */
export interface DowngradedRule {
  rule: SelectedRule;
  reason: string;
}

/** The story beats the communication skill emits (see story-data-review.md). */
export const STORY_STAGES = ["Persona", "Setup", "Status", "Gap", "Plan", "Execute", "Resolution"];
