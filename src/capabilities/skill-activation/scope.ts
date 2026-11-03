import { loadAllSkills } from "@core/skills/loader";
import { loadWorkspaceSkills } from "@rules/loader";
import type { Skill } from "wfp-format/skill";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export async function ensureEnabled(): Promise<void> {
  void currentDatabaseId;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

export function requireWs() {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  return getSessionByDatabaseId(currentDatabaseId)!;
}

/** App skills (scope/enablement-filtered) merged with the workspace's own
 *  skills (source: "workspace"). The unified skill surface for activation. */
export function unifiedSkills(scope?: Skill["scope"]): Skill[] {
  const app = loadAllSkills(scope, currentDatabaseId ?? undefined);
  const workspace = currentDatabaseId ? loadWorkspaceSkills(currentDatabaseId) : [];
  return [...app, ...workspace];
}

export function getSkillCatalog(): string {
  try {
    const skills = unifiedSkills("chat");
    if (skills.length === 0) return "No skills available.";
    return skills
      .map((s) => {
        const body = s.content.replace(/^---[\s\S]*?---\n*/, "").trim();
        const desc = body.slice(0, 200);
        return `- **${s.name}** (${s.source ?? "app"}): ${desc}`;
      })
      .join("\n");
  } catch (err: any) {
    return `Error loading skills: ${err.message}`;
  }
}

export function getSkillContent(name: string): string {
  const skills = unifiedSkills("chat");
  const skill = skills.find((s) => s.name === name);
  if (!skill) return `Skill "${name}" not found. Available skills:\n${getSkillCatalog()}`;
  const body = skill.content.replace(/^---[\s\S]*?---\n*/, "").trim();
  return `**Skill: ${skill.name}** (${skill.source ?? "app"})\n\n${body}`;
}

/** Find a skill across app + workspace skills by name (for `get_skill`). */
export function findSkill(name: string): Skill | undefined {
  return unifiedSkills().find((s) => s.name === name);
}
