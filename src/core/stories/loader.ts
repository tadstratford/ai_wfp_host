/**
 * Story loader — loads the server-wide story (meta-plan) catalog from markdown
 * files under `src/core/stories/*.md`. Stories are app-shipped (read-only), like
 * skills, but declare an ordered list of beats rather than a single instruction
 * set. Materialized into `catalog_stories` / `catalog_beats` at startup.
 */

import * as fs from "fs";
import type { Beat, BeatTemplateId, StoryArchetype, VerifyRule } from "wfp-format/story";

interface RawBeat {
  id?: string;
  skills?: string[];
  template?: string;
  verify?: string;
  write?: boolean;
}

interface RawNoul {
  id?: string;
  instructions?: string;
}

const TEMPLATES = new Set<string>([
  "persona", "clarify", "skim", "map", "verdicts", "findings",
  "remediation", "journal", "report", "answer",
]);

const VERIFY_RULES = new Set<string>([
  "none", "accurate", "grounded-actionable", "complete-accurate", "balanced",
]);

export const BEAT_TEMPLATES: BeatTemplateId[] = Array.from(TEMPLATES) as BeatTemplateId[];
export const BEAT_VERIFY_RULES: VerifyRule[] = Array.from(VERIFY_RULES) as VerifyRule[];

function parseJsonArray<T>(raw: string): T[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
  return parsed as T[];
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  noulsRaw?: string;
  beatsRaw?: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) return {};
  const out: ParsedFrontmatter = {};
  for (const line of m[1].split("\n")) {
    const fm = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (!fm) continue;
    const key = fm[1].trim();
    const value = fm[2].trim();
    if (key === "name") out.name = value;
    else if (key === "description") out.description = value;
    else if (key === "nouls") out.noulsRaw = value;
    else if (key === "beats") out.beatsRaw = value;
  }
  return out;
}

function parseStory(raw: string, fileName: string): StoryArchetype {
  const fm = parseFrontmatter(raw);
  if (!fm.name) throw new Error(`story "${fileName}" is missing a name`);

  const noulsRaw = fm.noulsRaw ? parseJsonArray<RawNoul>(fm.noulsRaw) : [];
  const nouls: Record<string, string> = {};
  for (const n of noulsRaw) {
    if (!n.id || !n.instructions) throw new Error(`story "${fm.name}" has a noul without id/instructions`);
    nouls[n.id] = n.instructions;
  }

  const beatsRaw = fm.beatsRaw ? parseJsonArray<RawBeat>(fm.beatsRaw) : [];
  const beats: Beat[] = beatsRaw.map((b) => {
    if (!b.id || !b.template) throw new Error(`story "${fm.name}" has a beat without id/template`);
    if (!TEMPLATES.has(b.template)) throw new Error(`story "${fm.name}" beat "${b.id}" has unknown template "${b.template}"`);
    if (!b.verify || !VERIFY_RULES.has(b.verify)) throw new Error(`story "${fm.name}" beat "${b.id}" has unknown verify "${b.verify}"`);
    const skills = (b.skills ?? []).map((s) => {
      const name = typeof s === "string" ? s.trim() : "";
      if (!name) throw new Error(`story "${fm.name}" beat "${b.id}" has an empty skill name`);
      return name;
    });
    return {
      id: b.id,
      ...(skills.length ? { skills } : {}),
      template: b.template as BeatTemplateId,
      verify: b.verify as VerifyRule,
      ...(b.write ? { write: true } : {}),
    };
  });

  return {
    id: fm.name,
    description: fm.description ?? "",
    nouls,
    beats,
  };
}

/** Load + validate all story markdown. Fails closed on any malformed story. */
export function loadStories(): StoryArchetype[] {
  const dir = __dirname;
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const stories: StoryArchetype[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = fs.readFileSync(`${dir}/${file}`, "utf-8");
    const story = parseStory(raw, file);
    if (seen.has(story.id)) throw new Error(`duplicate story id "${story.id}"`);
    seen.add(story.id);
    if (story.beats.length === 0) throw new Error(`story "${story.id}" has no beats`);
    if (Object.keys(story.nouls).length === 0) throw new Error(`story "${story.id}" has no classifier nouls`);
    stories.push(story);
  }
  return stories;
}
