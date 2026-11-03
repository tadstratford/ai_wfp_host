/**
 * Catalog accessor — the merged, workspace-aware view of the server-wide
 * catalog plus the workspace's own skills and stories. This is what the Skills
 * and Stories pages read.
 *
 * Server-wide: app skills, tools (from SQLite, materialized at startup).
 * Per-workspace: workspace-authored skills (from the .wfp document, merged into
 * `skills` with `source: "workspace"`) and workspace-authored stories.
 */

import { select } from "@backend/core/admin/supabase";
import { loadWorkspaceSkills } from "@rules/loader";
import { loadWorkspaceStories } from "../core/stories/workspace";
import { materializeCatalog } from "./materialize";

export interface CatalogTool {
  name: string;
  role?: string | null;
  description?: string | null;
}

export interface CatalogSkill {
  name: string;
  description?: string | null;
  scope?: string | null;
  tags: string[];
  /** `app` = shipped skill, `workspace` = authored in the .wfp document. */
  source?: "app" | "workspace";
  tools: CatalogTool[];
}

export interface CatalogBeat {
  storyName: string;
  beatId: string;
  sortOrder: number;
  skills: string[];
  template: string;
  verify: string;
  write: boolean;
}

export interface CatalogStory {
  name: string;
  description?: string | null;
  nouls: Record<string, string>;
  beats: CatalogBeat[];
  /** `app` = server-shipped story; `workspace` = authored in the .wfp document. */
  source?: "app" | "workspace";
}

export interface CatalogWorkspace {
  skills: CatalogSkill[];
  stories: CatalogStory[];
}

interface SkillRow {
  name: string;
  description: string | null;
  scope: string | null;
  tags: string[];
}
interface ToolRow {
  name: string;
  description: string | null;
  class: string | null;
  capability_key: string | null;
}
interface SkillToolRow {
  skill_name: string;
  tool_name: string;
  role: string | null;
}
interface StoryRow {
  name: string;
  description: string | null;
  nouls: string | null;
}
interface BeatRow {
  story_name: string;
  beat_id: string;
  sort_order: number;
  skills: string[] | null;
  template: string | null;
  verify: string | null;
  write: number | null;
}

/** Read the server-wide catalog merged with a workspace's skills + stories. */
export async function getCatalogForWorkspace(databaseId: string): Promise<CatalogWorkspace> {
  // Self-heal when the startup materialization hasn't run (tests, lazy open).
  const probe = await select<SkillRow>("catalog_skills");
  if (!probe.data || probe.data.length === 0) {
    await materializeCatalog();
  }

  const [skillsRes, toolsRes, skillToolsRes, storiesRes, beatsRes] = await Promise.all([
    select<SkillRow>("catalog_skills"),
    select<ToolRow>("catalog_tools"),
    select<SkillToolRow>("catalog_skill_tools"),
    select<StoryRow>("catalog_stories"),
    select<BeatRow>("catalog_beats"),
  ]);

  const tools = toolsRes.data ?? [];
  const toolDesc = new Map(tools.map((t) => [t.name, t.description]));

  const linksBySkill = new Map<string, SkillToolRow[]>();
  for (const l of skillToolsRes.data ?? []) {
    const list = linksBySkill.get(l.skill_name) ?? [];
    list.push(l);
    linksBySkill.set(l.skill_name, list);
  }

  const skills: CatalogSkill[] = (skillsRes.data ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    scope: s.scope,
    tags: Array.isArray(s.tags) ? s.tags : [],
    source: "app",
    tools: (linksBySkill.get(s.name) ?? []).map((l) => ({
      name: l.tool_name,
      role: l.role,
      description: toolDesc.get(l.tool_name) ?? null,
    })),
  }));

  const workspaceSkills: CatalogSkill[] = loadWorkspaceSkills(databaseId).map((r) => ({
    name: r.name,
    description: r.description ?? null,
    scope: r.scope ?? null,
    tags: r.tags ?? [],
    source: "workspace",
    tools: (r.tools ?? []).map((t) => ({
      name: t.name,
      role: t.role ?? null,
      description: toolDesc.get(t.name) ?? null,
    })),
  }));

  const allSkills = [...skills, ...workspaceSkills];

  const beatsByStory = new Map<string, CatalogBeat[]>();
  for (const b of beatsRes.data ?? []) {
    const list = beatsByStory.get(b.story_name) ?? [];
    list.push({
      storyName: b.story_name,
      beatId: b.beat_id,
      sortOrder: b.sort_order ?? 0,
      skills: Array.isArray(b.skills) ? b.skills : [],
      template: b.template ?? "",
      verify: b.verify ?? "none",
      write: (b.write ?? 0) === 1,
    });
    beatsByStory.set(b.story_name, list);
  }

  const stories: CatalogStory[] = (storiesRes.data ?? []).map((s) => {
    let nouls: Record<string, string> = {};
    if (s.nouls) {
      try { nouls = JSON.parse(s.nouls) as Record<string, string>; } catch { /* leave empty */ }
    }
    return {
      name: s.name,
      description: s.description,
      nouls,
      beats: (beatsByStory.get(s.name) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
      source: "app",
    };
  });

  // Workspace-authored stories layer over the server catalog (same id wins).
  const workspaceStories: CatalogStory[] = loadWorkspaceStories(databaseId).map((ws) => ({
    name: ws.id,
    description: ws.description,
    nouls: ws.nouls,
    beats: ws.beats.map((b, i) => ({
      storyName: ws.id,
      beatId: b.id,
      sortOrder: i,
      skills: b.skills ?? [],
      template: b.template,
      verify: b.verify,
      write: b.write ?? false,
    })),
    source: "workspace",
  }));

  const mergedStories = [...stories, ...workspaceStories].reduce<Map<string, CatalogStory>>((acc, s) => {
    acc.set(s.name, s);
    return acc;
  }, new Map());

  return { skills: allSkills, stories: Array.from(mergedStories.values()) };
}
