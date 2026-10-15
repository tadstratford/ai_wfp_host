/**
 * Build Pipeline Types
 *
 * Types for the multi-stage workflow build pipeline.
 * Used by build-pipeline.ts and index.ts.
 */

import type { LLMClientConfig, LLMCallOptions, LLMCallResult } from "@backend/core/llm/llm-client";

/** Privacy-aware LLM caller — masks entities, calls LLM, unmasks, logs usage. */
export type LLMCaller = (source: string, opts: LLMCallOptions) => Promise<LLMCallResult>;

// ---------------------------------------------------------------------------
// Build Plan — the structured output of Stage 1 (planning)
// ---------------------------------------------------------------------------

/** A workflow node in the plan */
export interface BuildPlanNode {
  /** Display label for the node */
  label: string;
  /** Built-in, native, or MCP tool ID */
  toolId: string;
  /** Parameter wiring for this node */
  toolParameters?: Record<string, any>;
  /** Chat message to show when this node completes */
  chatMsgBody?: string;
}

/** Describes one condition the audit step should check. */
export interface AuditCheck {
  /** A short statement of what to check. */
  condition: string;
  /**
   * The name of the workflow parameter or data variable this check reads
   * (e.g. "{{result}}" or "{{report_data}}").
   */
  reads: string;
}

/** Spec for the auto-generated audit step at the end of every workflow. */
export interface AuditSpec {
  /** Human-readable description of what success looks like — shown in the plan. */
  description: string;
  /** The checks the audit tool's code should perform deterministically. */
  checks: AuditCheck[];
}

/** The complete build plan — output of Stage 1, input to Stages 2-3 */
export interface BuildPlan {
  workflowName: string;
  workflowDescription: string;
  /**
   * Optional nav group. When set, the built workflow becomes a "page" in the
   * workspace left-nav under a section named for this group and is opened by
   * running it ephemerally (see workflow.group in wfp-format). Unset → the
   * workflow lives only on the workflows board. The planner sets this when the
   * request asks for an app/page in a named section (e.g. "group: Accounting").
   */
  group?: string;
  nodes: BuildPlanNode[];
  /** Optional audit spec — the planner describes what success looks like for this workflow. */
  audit?: AuditSpec;
}

// ---------------------------------------------------------------------------
// Pipeline params and results
// ---------------------------------------------------------------------------

export interface BuildPipelineParams {
  userMessage: string;
  databaseId: string;
  userId: string;
  llmConfig: LLMClientConfig;
  /** Privacy-aware LLM caller from SessionContext. Falls back to raw callLLM if not provided. */
  callLLM?: LLMCaller;
  /** If set, this is the approved plan to execute (Stages 2-4) */
  approvedPlan?: BuildPlan;
  /** Chat history for context */
  chatHistory?: Array<{ role: string; content: string }>;
  /** Session ID for SSE progress updates (optional — if set, writes spinner messages to session) */
  sessionId?: string;
  /** Planner prompt template to use for Stage 1 (defaults to "pipeline/planner").
   *  The "save chat session as workflow" path passes "pipeline/planner-convert". */
  plannerPrompt?: string;
}

export interface BuildPipelineResult {
  /** Text shown to user */
  text: string;
  /** Step-by-step log */
  log: string[];
  /** Actions that were executed */
  actionsExecuted: string[];
  /** If Stage 1 only: the plan JSON to store for approval */
  pendingPlan?: BuildPlan;
  /** If Stage 1 only: `{{name}}` inputs that don't resolve to a data file / prior output / pause. */
  unresolvedInputs?: string[];
  /** The workflow ID if build completed */
  workflowId?: string;
}

