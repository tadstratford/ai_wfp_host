import { Context } from "hono";
import type { User } from "@backend/types";
import {
  getCatalogForWorkspace,
  type CatalogWorkspace,
  type CatalogSkill,
} from "@backend/catalog";

/**
 * Skills page — a flat list of skills and their tools:
 *
 *   skill → tool
 *
 * with the workspace's own skills (source: "workspace") folded in. Filters
 * narrow across skill, tool, and app/user source. Each skill's tools render as
 * pills that drill back into the filter list.
 */

interface SkillsFilters {
  skill?: string;
  tool?: string;
  source?: "app" | "user";
}

function parseFilters(c: Context): SkillsFilters {
  const q = (k: string) => c.req.query(k) || undefined;
  const source = q("source");
  return {
    skill: q("skill"),
    tool: q("tool"),
    source: source === "app" || source === "user" ? source : undefined,
  };
}

function filterUrl(filters: SkillsFilters, patch: Partial<SkillsFilters>): string {
  const next: SkillsFilters = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.skill) params.set("skill", next.skill);
  if (next.tool) params.set("tool", next.tool);
  if (next.source) params.set("source", next.source);
  const qs = params.toString();
  return qs ? `/app/skills?${qs}` : "/app/skills";
}

const SELECT_CLS =
  "rounded-lg border border-ink/[0.1] dark:border-white/[0.1] bg-white dark:bg-ink-800 px-2 py-1.5 text-xs text-ink-700 dark:text-white/80";
const CHIP_CLS =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border";

function SkillsPanel({ catalog, filters }: { catalog: CatalogWorkspace; filters: SkillsFilters }) {
  const skillNames = new Set<string>(catalog.skills.map((s) => s.name));
  const toolNames = new Set<string>();
  for (const s of catalog.skills) for (const t of s.tools) toolNames.add(t.name);

  const filteredSkills = catalog.skills.filter((s) => {
    if (filters.source && (s.source ?? "app") !== filters.source) return false;
    if (filters.skill && s.name !== filters.skill) return false;
    if (filters.tool && !s.tools.some((t) => t.name === filters.tool)) return false;
    return true;
  });

  const anyFilter = Boolean(filters.skill || filters.tool || filters.source);

  return (
    <div id="skills-panel" class="max-w-[1100px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <h1 class="text-2xl font-bold text-ink dark:text-white mb-1">Skills</h1>
      <p class="text-sm text-ink-500 dark:text-white/60 mb-5">
        Skills and the tools they use. A skill applies when a story's beat names
        it. Workspace skills are marked <span class="font-semibold">user</span>.
      </p>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <form
        hx-get="/app/skills"
        hx-target="#skills-panel"
        hx-swap="outerHTML"
        hx-push-url="true"
        class="flex flex-wrap items-center gap-2 mb-5 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 p-3"
      >
        <select name="skill" class={SELECT_CLS}>
          <option value="">All skills</option>
          {Array.from(skillNames).sort().map((n) => <option value={n} selected={filters.skill === n}>{n}</option>)}
        </select>
        <select name="tool" class={SELECT_CLS}>
          <option value="">All tools</option>
          {Array.from(toolNames).sort().map((n) => <option value={n} selected={filters.tool === n}>{n}</option>)}
        </select>
        <select name="source" class={SELECT_CLS}>
          <option value="">App + user</option>
          <option value="app" selected={filters.source === "app"}>App skills</option>
          <option value="user" selected={filters.source === "user"}>User skills</option>
        </select>
        {anyFilter && (
          <a hx-get={filterUrl(filters, {})} hx-target="#skills-panel" hx-swap="outerHTML" hx-push-url="true" class="text-xs font-semibold text-coral-500 hover:text-coral-600 no-underline">
            Clear
          </a>
        )}
      </form>

      <div class="space-y-3">
        {filteredSkills.length === 0 ? (
          <p class="text-xs text-ink-400 dark:text-ink-500 italic">No skills match these filters.</p>
        ) : (
          filteredSkills.map((s) => <SkillCard s={s} filters={filters} />)
        )}
      </div>

      <div class="mt-6 pt-4 border-t border-ink/[0.08] dark:border-white/[0.08]">
        <a
          hx-get="/app/make-rule"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          hx-push-url="/app/make-rule"
          class="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white no-underline"
        >
          New user skill
        </a>
        <span class="ml-3 text-xs text-ink-400 dark:text-ink-500">
          Create a workspace skill (method, preference, or policy).
        </span>
      </div>
    </div>
  );
}

function SkillCard({ s, filters }: { s: CatalogSkill; filters: SkillsFilters }) {
  return (
    <div class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-4 py-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-baseline gap-2 flex-wrap">
          <a
            hx-get={filterUrl(filters, { skill: s.name, tool: undefined })}
            hx-target="#skills-panel"
            hx-swap="outerHTML"
            hx-push-url="true"
            class="text-sm font-semibold text-ink-700 dark:text-white/90 no-underline hover:underline"
          >
            {s.name}
          </a>
          {s.scope && (
            <span class="text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-white/50">{s.scope}</span>
          )}
          {s.source === "workspace" && (
            <span class="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">user</span>
          )}
        </div>
        {s.source === "workspace" && (
          <div class="flex items-center gap-1.5">
            <a
              hx-get={`/app/rules/${encodeURIComponent(s.name)}?mode=edit`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class="text-xs font-semibold text-brand-600 dark:text-brand-300 no-underline hover:underline"
            >
              edit
            </a>
            <button
              hx-delete={`/app/rules/${encodeURIComponent(s.name)}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              hx-confirm={`Delete user skill "${s.name}"?`}
              class="text-xs font-semibold text-ink-400 hover:text-coral-600 dark:text-white/50 dark:hover:text-coral-300"
            >
              delete
            </button>
          </div>
        )}
      </div>
      {s.description && <p class="mt-0.5 text-xs text-ink-500 dark:text-white/60">{s.description}</p>}
      {s.tools.length > 0 && (
        <div class="mt-2 flex flex-wrap gap-1.5 border-t border-ink/[0.05] dark:border-white/[0.05] pt-2">
          {s.tools.map((t) => (
            <a
              key={t.name}
              hx-get={filterUrl(filters, { tool: t.name, skill: undefined })}
              hx-target="#skills-panel"
              hx-swap="outerHTML"
              hx-push-url="true"
              title={t.role ? `${t.role}${t.description ? ` — ${t.description}` : ""}` : t.description ?? t.name}
              class={`${CHIP_CLS} no-underline bg-ink/[0.04] text-ink-600 dark:bg-white/[0.06] dark:text-white/70 hover:bg-brand-50 hover:text-brand-600 dark:hover:bg-brand-900/40 dark:hover:text-brand-300 cursor-pointer`}
            >
              <code>{t.name}</code>
              {t.role ? <span class="opacity-60">· {t.role}</span> : null}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export const skillsView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<div class="text-coral-500 p-6">No workspace open.</div>);
  }
  const catalog = await getCatalogForWorkspace(databaseId);
  const filters = parseFilters(c);
  return c.html(<SkillsPanel catalog={catalog} filters={filters} />);
};
