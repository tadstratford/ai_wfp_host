/**
 * Skill — a markdown instruction set loaded into the LLM prompt when relevant.
 *
 * Skills are app-level: shipped in src/skills/*.md, versioned in git, read-only.
 * Workspace-authored rules live in the .wfp document under `wfp.rules[]`
 * (see ./rule.ts) — a separate, user-editable node.
 */

export type SkillScope = "chat" | "workflow" | "chat+workflow";

export interface Skill {
  name: string;
  description?: string;
  scope?: SkillScope;
  tags?: string[];
  content: string;       // markdown body (Instructions + Tools needed)
  created_at?: string;
  updated_at?: string;
}
