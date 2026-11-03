import { Context } from "hono";
import type { User } from "@backend/types";
import {
  getCatalogForWorkspace,
  type CatalogWorkspace,
  type CatalogStory,
  type CatalogBeat,
} from "@backend/catalog";

/**
 * Stories page — a flat table of the hierarchy:
 *
 *   Story | Beat | Skill   (one row per skill)
 *
 * Workspace-authored stories (`.wfp stories[]`) layer over the shipped stories
 * and are editable/deletable. Filters narrow across story, beat, skill, and
 * app/workspace source.
 */

interface StoryFilters {
  story?: string;
  beat?: string;
  skill?: string;
  source?: "app" | "workspace";
}

function parseStoryFilters(c: Context): StoryFilters {
  const q = (k: string) => c.req.query(k) || undefined;
  const source = q("source");
  return {
    story: q("story"),
    beat: q("beat"),
    skill: q("skill"),
    source: source === "app" || source === "workspace" ? source : undefined,
  };
}

function filterUrl(filters: StoryFilters, patch: Partial<StoryFilters>): string {
  const next: StoryFilters = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.story) params.set("story", next.story);
  if (next.beat) params.set("beat", next.beat);
  if (next.skill) params.set("skill", next.skill);
  if (next.source) params.set("source", next.source);
  const qs = params.toString();
  return qs ? `/app/stories?${qs}` : "/app/stories";
}

const SELECT_CLS =
  "rounded-lg border border-ink/[0.1] dark:border-white/[0.1] bg-white dark:bg-ink-800 px-2 py-1.5 text-xs text-ink-700 dark:text-white/80";

interface Row {
  story: CatalogStory;
  beat: CatalogBeat;
  skill?: string;
}

function StoriesPanel({ catalog, filters }: { catalog: CatalogWorkspace; filters: StoryFilters }) {
  const storyNames = new Set<string>(catalog.stories.map((s) => s.name));
  const beatNames = new Set<string>();
  const skillNames = new Set<string>();
  for (const s of catalog.stories) {
    for (const b of s.beats) {
      beatNames.add(b.beatId);
      for (const name of b.skills ?? []) skillNames.add(name);
    }
  }

  const filteredStories = catalog.stories.filter((s) => {
    if (filters.source && (s.source ?? "app") !== filters.source) return false;
    if (filters.story && s.name !== filters.story) return false;
    return true;
  });

  const rows: Row[] = [];
  for (const st of filteredStories) {
    for (const b of st.beats) {
      if (filters.beat && b.beatId !== filters.beat) continue;
      const skills = (b.skills ?? []).filter((name) => !filters.skill || name === filters.skill);
      if (skills.length === 0) {
        rows.push({ story: st, beat: b });
      } else {
        for (const skill of skills) rows.push({ story: st, beat: b, skill });
      }
    }
  }

  const anyFilter = Boolean(filters.story || filters.beat || filters.skill || filters.source);

  return (
    <div id="stories-panel" class="max-w-[1100px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <h1 class="text-2xl font-bold text-ink dark:text-white mb-1">Stories</h1>
      <p class="text-sm text-ink-500 dark:text-white/60 mb-5">
        Each story is an ordered list of beats; each beat names the skills it uses.
      </p>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <form
        hx-get="/app/stories"
        hx-target="#stories-panel"
        hx-swap="outerHTML"
        hx-push-url="true"
        class="flex flex-wrap items-center gap-2 mb-5 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 p-3"
      >
        <select name="story" class={SELECT_CLS}>
          <option value="">All stories</option>
          {Array.from(storyNames).sort().map((n) => <option value={n} selected={filters.story === n}>{n}</option>)}
        </select>
        <select name="beat" class={SELECT_CLS}>
          <option value="">All beats</option>
          {Array.from(beatNames).sort().map((n) => <option value={n} selected={filters.beat === n}>{n}</option>)}
        </select>
        <select name="skill" class={SELECT_CLS}>
          <option value="">All skills</option>
          {Array.from(skillNames).sort().map((n) => <option value={n} selected={filters.skill === n}>{n}</option>)}
        </select>
        <select name="source" class={SELECT_CLS}>
          <option value="">App + workspace</option>
          <option value="app" selected={filters.source === "app"}>App stories</option>
          <option value="workspace" selected={filters.source === "workspace"}>Workspace stories</option>
        </select>
        {anyFilter && (
          <a hx-get={filterUrl(filters, {})} hx-target="#stories-panel" hx-swap="outerHTML" hx-push-url="true" class="text-xs font-semibold text-coral-500 hover:text-coral-600 no-underline">
            Clear
          </a>
        )}
      </form>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left border-b border-ink/[0.08] dark:border-white/[0.08] bg-ink/[0.02] dark:bg-white/[0.03]">
              <th class="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-white/60">Story</th>
              <th class="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-white/60">Beat</th>
              <th class="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-white/60">Skill</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colspan={3} class="px-4 py-6 text-center text-xs text-ink-400 dark:text-ink-500 italic">
                  No stories match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.story.name}:${r.beat.beatId}:${r.skill ?? ""}:${i}`} class="border-b border-ink/[0.05] dark:border-white/[0.05] last:border-b-0">
                  <td class="px-4 py-2 text-ink-700 dark:text-white/90">
                    <span class="font-medium">{r.story.name}</span>
                    {r.story.source === "workspace" && (
                      <>
                        <span class="ml-2 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">workspace</span>
                        <a
                          hx-get={`/app/make-story?id=${encodeURIComponent(r.story.name)}`}
                          hx-target="#main-panel"
                          hx-swap="innerHTML"
                          class="ml-2 text-[11px] font-semibold text-brand-600 dark:text-brand-300 no-underline hover:underline"
                        >
                          edit
                        </a>
                        <button
                          hx-delete={`/app/stories/${encodeURIComponent(r.story.name)}`}
                          hx-target="#main-panel"
                          hx-swap="innerHTML"
                          hx-confirm={`Delete story "${r.story.name}"?`}
                          class="ml-2 text-[11px] font-semibold text-ink-400 hover:text-coral-600 dark:text-white/50 dark:hover:text-coral-300"
                        >
                          delete
                        </button>
                      </>
                    )}
                  </td>
                  <td class="px-4 py-2 text-ink-600 dark:text-white/70">{r.beat.beatId}</td>
                  <td class="px-4 py-2">
                    {r.skill ? (
                      <a
                        hx-get={filterUrl(filters, { skill: r.skill, beat: undefined })}
                        hx-target="#stories-panel"
                        hx-swap="outerHTML"
                        hx-push-url="true"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border no-underline bg-ink/[0.04] text-ink-600 dark:bg-white/[0.06] dark:text-white/70 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-900/40 dark:hover:text-brand-300 cursor-pointer"
                      >
                        <code>{r.skill}</code>
                      </a>
                    ) : (
                      <span class="text-ink-300 dark:text-ink-600">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div class="mt-6">
        <a
          hx-get="/app/make-story"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          hx-push-url="/app/make-story"
          class="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white no-underline"
        >
          New story
        </a>
      </div>
    </div>
  );
}

export const storiesView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<div class="text-coral-500 p-6">No workspace open.</div>);
  }
  const catalog = await getCatalogForWorkspace(databaseId);
  const filters = parseStoryFilters(c);
  return c.html(<StoriesPanel catalog={catalog} filters={filters} />);
};
