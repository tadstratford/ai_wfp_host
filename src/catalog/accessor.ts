/**
 * Catalog accessor — the merged, workspace-aware view of the server-wide
 * catalog plus the workspace's own rules. This is what the skills/capabilities
 * page (and, later, routing) reads.
 *
 * Server-wide: skill groups, app skills, tools (from SQLite, materialized at
 * startup). Per-workspace: user rules (from the .wfp document) and the enabled
 * skill-group ids (from .wfp metadata).
 */

import { select } from "@backend/core/admin/supabase";
import { loadRules } from "@rules/loader";
import type { Rule } from "wfp-format/rule";
import { ensureEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";
import { materializeCatalog } from "./materialize";

export interface CatalogGroup {
  id: string;
  label: string;
  description?: string | null;
  alwaysOn: boolean;
  defaultOn: boolean;
  enabled: boolean;
}

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
  groupId?: string | null;
  /** `app` = shipped skill, `workspace` = authored in the .wfp document. */
  source?: "app" | "workspace";
  tools: CatalogTool[];
}

export interface CatalogBeat {
  storyName: string;
  beatId: string;
  sortOrder: number;
  skillName: string | null;
  template: string;
  verify: string;
  write: boolean;
}

export interface CatalogStory {
  name: string;
  description?: string | null;
  nouls: Record<string, string>;
  beats: CatalogBeat[];
}

export interface CatalogWorkspace {
  groups: CatalogGroup[];
  skills: CatalogSkill[];
  rules: Rule[];
  stories: CatalogStory[];
  enabledGroupIds: string[];
}

interface SkillRow {
  name: string;
  description: string | null;
  scope: string | null;
  tags: string[];
  group_id: string | null;
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
  skill_name: string | null;
  template: string | null;
  verify: string | null;
  write: number | null;
}
interface GroupRow {
  id: string;
  label: string;
  description: string | null;
  always_on: boolean;
  default_on: boolean;
  sort_order: number;
}

/** Read the server-wide catalog merged with a workspace's rules + enablement. */
export async function getCatalogForWorkspace(databaseId: string): Promise<CatalogWorkspace> {
  // Self-heal when the startup materialization hasn't run (tests, lazy open).
  const probe = await select<GroupRow>("skill_groups");
  if (!probe.data || probe.data.length === 0) {
    await materializeCatalog();
  }

  const [groupsRes, skillsRes, toolsRes, skillToolsRes, storiesRes, beatsRes] = await Promise.all([
    select<GroupRow>("skill_groups"),
    select<SkillRow>("catalog_skills"),
    select<ToolRow>("catalog_tools"),
    select<SkillToolRow>("catalog_skill_tools"),
    select<StoryRow>("catalog_stories"),
    select<BeatRow>("catalog_beats"),
  ]);

  const enabledGroupIds = await ensureEnabledSkillGroups(databaseId);
  const enabledSet = new Set(enabledGroupIds);

  const groups: CatalogGroup[] = (groupsRes.data ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      alwaysOn: g.always_on === true,
      defaultOn: g.default_on === true,
      enabled: g.always_on === true || enabledSet.has(g.id),
    }));

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
    groupId: s.group_id,
    source: "app",
    tools: (linksBySkill.get(s.name) ?? []).map((l) => ({
      name: l.tool_name,
      role: l.role,
      description: toolDesc.get(l.tool_name) ?? null,
    })),
  }));

  const rules = loadRules(databaseId);

  const beatsByStory = new Map<string, CatalogBeat[]>();
  for (const b of beatsRes.data ?? []) {
    const list = beatsByStory.get(b.story_name) ?? [];
    list.push({
      storyName: b.story_name,
      beatId: b.beat_id,
      sortOrder: b.sort_order ?? 0,
      skillName: b.skill_name ?? null,
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
    };
  });

  return { groups, skills, rules, stories, enabledGroupIds };
}
