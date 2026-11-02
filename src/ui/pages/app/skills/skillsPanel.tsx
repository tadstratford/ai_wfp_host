import { Context } from "hono";
import type { User } from "@backend/types";
import {
  getCatalogForWorkspace,
  type CatalogWorkspace,
} from "@backend/catalog";
import { saveEnabledSkillGroups } from "@backend/core/admin/skillGroupsService";

/**
 * Skills panel — the workspace's view of the server-wide catalog (skill groups →
 * skills → tools) merged with the workspace's own rules and enablement.
 *
 * Each group is shown with its skills and their tools; toggleable groups carry a
 * checkbox that enables/disables the whole group (tools follow the skills).
 * Always-on core groups are shown read-only. Rendered into #main-panel as the
 * "Skills" shell section, replacing the old /app/user capabilities card.
 */

function SkillsPanel({ catalog, user }: { catalog: CatalogWorkspace; user: User }) {
  const skillsByGroup = new Map<string, typeof catalog.skills>();
  for (const s of catalog.skills) {
    if (!s.groupId) continue;
    const list = skillsByGroup.get(s.groupId) ?? [];
    list.push(s);
    skillsByGroup.set(s.groupId, list);
  }

  const workspaceSkills = catalog.skills.filter((s) => s.source === "workspace");

  return (
    <div id="skills-panel" class="max-w-[1100px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <h1 class="text-2xl font-bold text-ink dark:text-white mb-1">Skills</h1>
      <p class="text-sm text-ink-500 dark:text-white/60 mb-6">
        What the assistant can do in this workspace. Enable a capability group to make
        its skills — and the tools those skills use — available to the assistant.
      </p>

      <form
        hx-post="/app/api/skills-save"
        hx-target="#skills-panel"
        hx-swap="outerHTML"
      >
        <div class="space-y-4">
          {catalog.groups.map((g) => {
            const groupSkills = skillsByGroup.get(g.id) ?? [];
            const toolsInGroup = groupSkills.flatMap((s) => s.tools);
            return (
              <section
                key={g.id}
                class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 p-5"
              >
                <div class="flex items-start gap-3">
                  {g.alwaysOn ? (
                    <span class="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-1.5 py-0.5 rounded">
                      always on
                    </span>
                  ) : (
                    <label class="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        name="groups"
                        value={g.id}
                        checked={g.enabled}
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span class="text-sm font-semibold text-ink dark:text-white">{g.label}</span>
                    </label>
                  )}
                  {g.alwaysOn && (
                    <span class="text-sm font-semibold text-ink dark:text-white">{g.label}</span>
                  )}
                </div>

                {g.description && (
                  <p class="mt-1 text-xs text-ink-500 dark:text-white/60">{g.description}</p>
                )}

                {groupSkills.length === 0 ? (
                  <p class="mt-3 text-xs text-ink-400 dark:text-ink-500 italic">No skills in this group.</p>
                ) : (
                  <div class="mt-3 space-y-3">
                    {groupSkills.map((s) => (
                      <div key={s.name} class="rounded-lg border border-ink/[0.06] dark:border-white/[0.06] px-3 py-2.5">
                        <div class="flex items-baseline gap-2 flex-wrap">
                          <span class="text-sm font-semibold text-ink-700 dark:text-white/90">{s.name}</span>
                          {s.scope && (
                            <span class="text-[10px] font-semibold uppercase tracking-wide text-ink-400 dark:text-white/50">{s.scope}</span>
                          )}
                        </div>
                        {s.description && (
                          <p class="mt-0.5 text-xs text-ink-500 dark:text-white/60">{s.description}</p>
                        )}
                        {s.tools.length > 0 && (
                          <ul class="mt-2 space-y-1 border-t border-ink/[0.05] dark:border-white/[0.05] pt-2">
                            {s.tools.map((t) => (
                              <li key={t.name} class="text-xs text-ink-500 dark:text-white/60">
                                <code class="text-brand-600 dark:text-brand-300">{t.name}</code>
                                {t.role ? <span class="text-ink-400 dark:text-white/40"> · {t.role}</span> : null}
                                {t.description ? <span class="text-ink-400 dark:text-white/40"> — {t.description}</span> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div class="mt-6 flex items-center gap-3">
          <button
            type="submit"
            class="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors"
          >
            Save capabilities
          </button>
          <span class="text-xs text-ink-400 dark:text-ink-500">
            Saved to this workspace — the assistant will use the enabled groups on the next request.
          </span>
        </div>
      </form>

      {/* Workspace skills — the workspace-authored skills layered on top of app skills. */}
      <div class="mt-8">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold text-ink-700 dark:text-white/80">Workspace skills</h2>
          <a
            hx-get="/app/rules"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-push-url="/app/rules"
            class="text-xs font-semibold text-brand-600 dark:text-brand-300 no-underline hover:underline"
          >
            Manage skills →
          </a>
        </div>
        {workspaceSkills.length === 0 ? (
          <p class="text-xs text-ink-400 dark:text-ink-500 italic">No workspace skills yet.</p>
        ) : (
          <div class="space-y-2">
            {workspaceSkills.map((r) => (
              <div
                key={r.name}
                class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-4 py-3"
              >
                <div class="text-sm font-semibold text-ink dark:text-white">{r.name}</div>
                {r.description && <p class="text-xs text-ink-500 dark:text-white/60 mt-0.5">{r.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
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
  return c.html(<SkillsPanel catalog={catalog} user={user} />);
};

export const skillsSaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No workspace open", 400);

  const formData = await c.req.formData();
  const selected = formData.getAll("groups").map(String);

  await saveEnabledSkillGroups(user.userId, databaseId, selected);

  const catalog = await getCatalogForWorkspace(databaseId);
  return c.html(<SkillsPanel catalog={catalog} user={user} />);
};
