/**
 * Rule — a workspace rule/policy/preference authored by the user and stored
 * in the .wfp document under the top-level `rules` node.
 *
 * Distinct from a `Skill` (app-level orchestration instructions shipped with
 * the code): rules are user data. The app uses a skill to create a rule.
 */

export interface Rule {
  name: string;
  description?: string;
  tags?: string[];
  content: string;       // markdown body (Instructions + Tools needed)
  created_at?: string;
  updated_at?: string;
}
