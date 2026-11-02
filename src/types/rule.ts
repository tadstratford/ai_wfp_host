/**
 * Rule — formerly a distinct workspace-authored type. Now unified with `Skill`:
 * a workspace rule IS a workspace-authored skill (`source: "workspace"`).
 *
 * Kept as a type alias so the many existing `wfp-format/rule` imports keep
 * compiling through the migration; new code should import `Skill` directly.
 */

import type { Skill } from "./skill";

/** A structured tool reference — the authoritative form of "which tool does this
 *  rule/skill use", replacing the prose `## Tools needed` backtick list. `name`
 *  must exist in the capability registry; `role` is a short note for the planner. */
export interface ToolRef {
  name: string;
  role?: string;
}

/** A workspace rule = a workspace-authored skill. */
export type Rule = Skill;
