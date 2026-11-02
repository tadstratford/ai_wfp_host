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
import type { ToolRef } from "wfp-format/rule";

/** The IO surface the orchestrator uses to talk to the session layer — messages,
 *  errors, and the workspace/session ids. Defined here (not imported from a
 *  removed version) so vers_11 stays self-contained. */
export interface OrchestratorIO {
  databaseId: string;
  userId: string;
  sessionId: string;
  workflowId?: string;
  addMessage: (msg: AddMessageArgs) => Promise<void>;
  addError: (title: string, detail?: string) => Promise<void>;
  mode: string;
  /** When true, emit the "thinking" transparency stream (classify options →
   *  outcome → compose → step-start) into the chat. Mirrors `chatVerbose`. */
  verbose: boolean;
}

export interface SelectedRule {
  name: string;
  description?: string;
  /** Full markdown body — loaded only after selection, never in the routing prompt. */
  content: string;
  /** Structured tool references (authoritative; not parsed from content). */
  tools?: ToolRef[];
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
  /** The story beat this step belongs to (drives the story-progress checklist). */
  beat?: string;
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
  provenance: { skills: string[]; rules: SelectedRule[]; story?: string; report?: boolean; beats?: string[] };
  createdAt: string;
}

/** A rule whose check could not be composed into a deterministic/classified step. */
export interface DowngradedRule {
  rule: SelectedRule;
  reason: string;
}

/** The story beats the communication skill emits (see story-data-review.md). */
export const STORY_STAGES = ["Persona", "Setup", "Status", "Gap", "Plan", "Execute", "Resolution"];
