import { loadAllSkills } from "@core/skills/loader";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export async function ensureEnabled(): Promise<void> {
  if (currentDatabaseId) await ensureEnabledSkillGroups(currentDatabaseId);
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

export function getSkillCatalog(): string {
  try {
    const skills = loadAllSkills("chat", currentDatabaseId ?? undefined);
    if (skills.length === 0) return "No skills available.";
    return skills
      .map((s) => {
        const body = s.content.replace(/^---[\s\S]*?---\n*/, "").trim();
        const desc = body.slice(0, 200);
        return `- **${s.name}** (${s.source}): ${desc}`;
      })
      .join("\n");
  } catch (err: any) {
    return `Error loading skills: ${err.message}`;
  }
}

export function getSkillContent(name: string): string {
  const skills = loadAllSkills("chat", currentDatabaseId ?? undefined);
  const skill = skills.find((s) => s.name === name);
  if (!skill) return `Skill "${name}" not found. Available skills:\n${getSkillCatalog()}`;
  const body = skill.content.replace(/^---[\s\S]*?---\n*/, "").trim();
  return `**Skill: ${skill.name}** (${skill.source})\n\n${body}`;
}
