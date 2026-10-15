import { loadRules } from "@rules/loader";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export function requireWs() {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  return getSessionByDatabaseId(currentDatabaseId)!;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

export function getRuleCatalog(): string {
  if (!currentDatabaseId) return "No workspace open.";
  try {
    const rules = loadRules(currentDatabaseId);
    if (rules.length === 0) return "No rules available.";
    return rules
      .map((r) => {
        const body = r.content.replace(/^---[\s\S]*?---\n*/, "").trim();
        const desc = body.slice(0, 200);
        return `- **${r.name}**: ${desc}`;
      })
      .join("\n");
  } catch (err: any) {
    return `Error loading rules: ${err.message}`;
  }
}

export function getRuleContent(name: string): string {
  if (!currentDatabaseId) return "No workspace open.";
  const rules = loadRules(currentDatabaseId);
  const rule = rules.find((r) => r.name === name);
  if (!rule) return `Rule "${name}" not found. Available rules:\n${getRuleCatalog()}`;
  const body = rule.content.replace(/^---[\s\S]*?---\n*/, "").trim();
  return `**Rule: ${rule.name}**\n\n${body}`;
}
