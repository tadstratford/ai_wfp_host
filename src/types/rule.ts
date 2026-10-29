/**
 * Rule — a workspace rule/policy/preference authored by the user and stored
 * in the .wfp document under the top-level `rules` node.
 *
 * Distinct from a `Skill` (app-level orchestration instructions shipped with
 * the code): rules are user data. The app uses a skill to create a rule.
 */

/** A structured tool reference — the authoritative form of "which tool does this
 *  rule/skill use", replacing the prose `## Tools needed` backtick list. `name`
 *  must exist in the capability registry; `role` is a short note for the planner. */
export interface ToolRef {
  name: string;
  role?: string;
}

export interface Rule {
  name: string;
  description?: string;
  tags?: string[];
  content: string;       // markdown body (## Instructions + ## Rules)
  /** Structured tool references (authoritative; no longer parsed from content). */
  tools?: ToolRef[];
  created_at?: string;
  updated_at?: string;
}
