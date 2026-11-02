/**
 * Skill — a markdown instruction set loaded into the LLM prompt when relevant.
 *
 * Skills are app-level (shipped in markdown, read-only) OR workspace-authored
 * (stored in the .wfp document under `wfp.skills[]` — the unified home for what
 * was formerly the `wfp.rules[]` node). `source` distinguishes the two.
 */

export type SkillScope = "chat" | "workflow" | "chat+workflow";

/** Provenance of a skill: `app` = shipped with the code (markdown, read-only);
 *  `workspace` = authored by the user and stored in the `.wfp` document (this is
 *  what the former `wfp.rules[]` node becomes). */
export type SkillSource = "app" | "workspace";

export interface Skill {
  name: string;
  description?: string;
  scope?: SkillScope;
  tags?: string[];
  /** Canonical skill-group id (capability) this skill belongs to — the single
   *  source of truth for enablement. References `skill_groups.id`. */
  group?: string;
  /** App-shipped vs workspace-authored. Absent on legacy records (treated as
   *  `workspace` when stored under the `.wfp` rules/skills node). */
  source?: SkillSource;
  content: string;       // markdown body (Instructions + Rules)
  /** Structured tool references (authoritative; parsed once from frontmatter). */
  tools?: { name: string; role?: string }[];
  created_at?: string;
  updated_at?: string;
}
