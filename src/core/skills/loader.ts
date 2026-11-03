/**
 * Skills Loader — loads app skills from *.md files.
 *
 * Skills are markdown files with frontmatter, shipped read-only with the code.
 * They live in two places: core skills in this directory (`src/core/skills/`)
 * and capability-owned skills under `src/capabilities/<name>/skills/`. The
 * loader scans both. Workspace-authored skills live in the .wfp document under
 * `wfp.skills[]` (see src/rules/loader.ts). Skills are flat — a story's beats
 * decide which ones apply to a request.
 */

import * as fs from "fs";
import * as path from "path";
import type { Skill, SkillScope } from "wfp-format/skill";

export interface SkillWithSource extends Skill {
  source: "app";
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
 * Parses simple YAML frontmatter (name, scope, tags, tools).
 */
export function loadAppSkills(databaseId?: string): SkillWithSource[] {
  void databaseId;
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
          tools: parsed.tools,
          source: "app",
        });
      } catch {
        // Skip malformed skill files
      }
    }
  }

  return skills;
}

/** Extract the tool names declared in a skill's `## Tools needed` section. Used
 *  only for legacy migration — new skills declare tools in frontmatter. */
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
  tools?: { name: string; role?: string }[];
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
      const rawValue = m[2].trim();
      if (key === "tools") {
        // Structured JSON — keep the raw JSON string for parseTools.
        result[key] = rawValue;
        continue;
      }
      let value: any = rawValue;
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
    tools: parseTools(result.tools),
    content,
  };
}

/** Parse a frontmatter `tools:` value into structured `{ name, role? }[]`.
 *  Accepts a JSON array (single line). Invalid input → undefined (no tools),
 *  so a malformed declaration fails safe and is caught by validation-on-open. */
function parseTools(value: unknown): { name: string; role?: string }[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const arr = JSON.parse(value);
    if (!Array.isArray(arr)) return undefined;
    const out: { name: string; role?: string }[] = [];
    for (const item of arr) {
      if (item && typeof item === "object" && typeof (item as any).name === "string") {
        out.push({
          name: (item as any).name,
          ...(typeof (item as any).role === "string" ? { role: (item as any).role } : {}),
        });
      }
    }
    return out;
  } catch {
    return undefined;
  }
}
