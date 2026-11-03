/**
 * materializeCatalog — build the server-wide catalog (skills, tools, skill→tool
 * links) from the markdown skill files + capability registry and upsert it into
 * SQLite.
 *
 * The markdown + registry remain the source of truth; SQLite is a derived,
 * queryable snapshot rebuilt (idempotently) at startup. Workspace skills are
 * NOT here — they are workspace data merged at read time by the accessor.
 */

import { loadAppSkills, declaredTools } from "@core/skills/loader";
import { loadStories } from "../core/stories/loader";
import { listCapabilities } from "@capabilities/registry";
import { upsert } from "@backend/core/admin/supabase";

export async function materializeCatalog(): Promise<void> {
  // 1) Skills — name, description, scope, tags, content (frontmatter).
  const skills = loadAppSkills();
  if (skills.length > 0) {
    await upsert(
      "catalog_skills",
      skills.map((s) => ({
        name: s.name,
        description: s.description ?? null,
        scope: s.scope ?? null,
        tags: s.tags ?? [],
        content: s.content,
      })),
    );
  }

  // 2) Tools — every capability tool (name, description, class, capability key).
  const toolRows: Record<string, unknown>[] = [];
  for (const cap of listCapabilities()) {
    for (const t of cap.tools) {
      toolRows.push({
        name: t.name,
        description: t.description ?? null,
        class: t.class,
        capability_key: cap.manifest.key,
      });
    }
  }
  if (toolRows.length > 0) await upsert("catalog_tools", toolRows);

  // 3) Skill→tool links (with the skill's `role` note when declared).
  const skillToolRows: Record<string, unknown>[] = [];
  for (const s of skills) {
    if (s.tools && s.tools.length > 0) {
      for (const t of s.tools) {
        skillToolRows.push({ skill_name: s.name, tool_name: t.name, role: t.role ?? null });
      }
    } else {
      for (const n of declaredTools(s.content)) {
        skillToolRows.push({ skill_name: s.name, tool_name: n, role: null });
      }
    }
  }
  if (skillToolRows.length > 0) await upsert("catalog_skill_tools", skillToolRows);

  // 4) Stories — server-wide story (meta-plan) + beat catalog from story
  //    markdown. Best-effort: a malformed story is logged, not fatal, so a
  //    typo in app-shipped markdown can't crash startup.
  try {
    const stories = loadStories();
    if (stories.length > 0) {
      await upsert(
        "catalog_stories",
        stories.map((s) => ({
          name: s.id,
          description: s.description || null,
          nouls: JSON.stringify(s.nouls),
        })),
      );
      const beatRows: Record<string, unknown>[] = [];
      for (const s of stories) {
        s.beats.forEach((b, i) => {
          beatRows.push({
            story_name: s.id,
            beat_id: b.id,
            sort_order: i,
            skills: b.skills ?? [],
            template: b.template,
            verify: b.verify,
            write: b.write ? 1 : 0,
          });
        });
      }
      if (beatRows.length > 0) await upsert("catalog_beats", beatRows);
    }
  } catch (err: any) {
    console.warn(`[catalog] story materialization skipped: ${err.message}`);
  }
}
