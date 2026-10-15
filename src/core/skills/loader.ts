/**
 * Skills Loader — loads app skills from *.md files.
 *
 * Skills are markdown files with frontmatter, shipped read-only with the code.
 * They live in two places: core skills in this directory (`src/core/skills/`)
 * and capability-owned skills under `src/capabilities/<name>/skills/`. The
 * loader scans both. Workspace-authored rules live in the .wfp document under
 * `wfp.rules[]` (see src/rules/loader.ts).
 */

import * as fs from "fs";
import * as path from "path";
import type { Skill, SkillScope } from "wfp-format/skill";
import {
  CORE_SKILLS,
  DEFAULT_SKILL_GROUP_KEYS,
  skillNamesForGroups,
} from "@shared/skillGroups";

export interface SkillWithSource extends Skill {
  source: "app";
}

/**
 * Per-database enabled skill group keys. Populated by the host before chat or
 * workflow runs resolve skills (see skillPrefs service). An absent entry means
 * "no preference stored yet" → DEFAULT_SKILL_GROUP_KEYS applies.
 */
const enabledGroupsByDatabase = new Map<string, string[]>();

/** Record the enabled skill group keys for a database (persisted preference). */
export function setEnabledGroupsForDatabase(
  databaseId: string,
  groupKeys: string[],
): void {
  enabledGroupsByDatabase.set(databaseId, groupKeys);
}

/** The concrete skill names a database may use, from its groups (or defaults). */
export function enabledSkillNamesForDatabase(databaseId?: string): Set<string> {
  const groups = databaseId
    ? enabledGroupsByDatabase.get(databaseId)
    : undefined;
  return new Set(skillNamesForGroups(groups ?? DEFAULT_SKILL_GROUP_KEYS));
}

/** Directories that hold skill markdown: core skills + every capability's
 *  `skills/` folder. */
function skillDirectories(): string[] {
  const dirs = [__dirname];
  try {
    const capabilitiesDir = path.resolve(__dirname, "..", "..", "capabilities");
    for (const entry of fs.readdirSync(capabilitiesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillsDir = path.join(capabilitiesDir, entry.name, "skills");
      if (fs.existsSync(skillsDir)) dirs.push(skillsDir);
    }
  } catch {
    // capabilities dir not present — core skills only
  }
  return dirs;
}

/**
 * Load all app skills from the skill markdown directories.
 * Parses simple YAML frontmatter (name, scope, tags).
 *
 * @param databaseId - when given, the loaded skills are filtered to the
 *   database's enabled skill groups (defaults when no preference is cached).
 *   Omit for administration views that should list every app skill.
 */
export function loadAppSkills(databaseId?: string): SkillWithSource[] {
  const skills: SkillWithSource[] = [];

  for (const skillsDir of skillDirectories()) {
    let files: string[];
    try {
      files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(skillsDir, file), "utf-8");
        const parsed = parseFrontmatter(raw);
        skills.push({
          name: parsed.name || file.replace(/\.md$/, ""),
          description: parsed.description,
          scope: (parsed.scope as SkillScope) || undefined,
          tags: parsed.tags || [],
          content: parsed.content,
          source: "app",
        });
      } catch {
        // Skip malformed skill files
      }
    }
  }

  const enabled = databaseId ? enabledSkillNamesForDatabase(databaseId) : null;

  return skills.filter((s) => {
    if (enabled && !enabled.has(s.name) && !CORE_SKILLS.has(s.name)) return false;
    return true;
  });
}

/** Extract the tool names declared in a skill's `## Tools needed` section. */
export function declaredTools(content: string): string[] {
  const section = content.match(/## Tools needed\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!section) return [];
  const tools: string[] = [];
  const re = /`([a-zA-Z0-9_]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section[1])) !== null) tools.push(match[1]);
  return tools;
}


/**
 * Load all app skills for a given scope.
 */
export function loadAllSkills(
  scope?: SkillScope,
  databaseId?: string,
): SkillWithSource[] {
  const app = loadAppSkills(databaseId);

  if (!scope) return app;

  return app.filter(
    (s) => !s.scope || s.scope === scope || s.scope === "chat+workflow",
  );
}

// ── Simple frontmatter parser ────────────────────────────────────────────────

function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
  scope?: string;
  tags?: string[];
  content: string;
} {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    return { content: raw };
  }

  const fm = fmMatch[1];
  const content = fmMatch[2].trim();
  const result: Record<string, any> = {};

  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (m) {
      const key = m[1].trim();
      let value: any = m[2].trim();
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
      }
      result[key] = value;
    }
  }

  return {
    name: result.name,
    description: result.description,
    scope: result.scope,
    tags: result.tags,
    content,
  };
}
