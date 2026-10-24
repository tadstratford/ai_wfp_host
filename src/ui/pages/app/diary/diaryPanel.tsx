import { Context } from "hono";
import type { User } from "@backend/types";
import type { Diary } from "wfp-format";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { ensureDiaryHighlights } from "@backend/core/workspace/diary/summarize";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function topPairs(map: Record<string, number>, limit: number): string {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
}

/**
 * Diary — the read-only, three-tier view of the activity diary: narrative
 * (whole-file story) → summaries → entries. Reading opportunistically fills one
 * LLM highlight so the story reads naturally over successive views.
 */
export const diaryView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  if (session) {
    try {
      await ensureDiaryHighlights(databaseId);
    } catch (err) {
      console.error("[diaryView] highlight fill failed:", err);
    }
  }

  const diary: Diary = session ? session.getDiary() : { entries: [], summaries: [], narrative: [] };
  const narrative = [...diary.narrative].reverse();
  const summaries = [...diary.summaries].reverse();
  const entries = [...diary.entries].reverse();

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="mb-6">
        <h2 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">Diary</h2>
        <p class="text-sm text-ink-500">
          A running story of what's happening in this workspace — and by whom.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 mb-6">
        <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          {narrative.length} {narrative.length === 1 ? "period" : "periods"}
        </span>
        <span class="pill bg-ink/[0.04] text-ink-500 dark:bg-white/[0.06] dark:text-white/60">
          {summaries.length} {summaries.length === 1 ? "summary" : "summaries"}
        </span>
        <span class="pill bg-ink/[0.04] text-ink-500 dark:bg-white/[0.06] dark:text-white/60">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {narrative.length === 0 && summaries.length === 0 && entries.length === 0 ? (
        <div class="card p-10 text-center text-sm text-ink-500">
          Nothing recorded yet. Activity (sessions, data loads, rule changes) is added here automatically.
        </div>
      ) : (
        <div class="space-y-8">
          {narrative.length > 0 && (
            <section>
              <h3 class="text-xs font-bold uppercase tracking-wider text-ink-400 dark:text-white/50 mb-2">
                The whole-file diary
              </h3>
              <div class="space-y-1.5">
                {narrative.map((n) => (
                  <div class="card p-4 border-l-4 border-l-brand-500 bg-brand-50/40 dark:bg-brand-900/15">
                    <div class="text-xs text-ink-400 dark:text-white/50 mb-1">
                      {fmtTime(n.from)} → {fmtTime(n.to)} · {n.count} summaries
                    </div>
                    {n.highlights.length > 0 ? (
                      <ul class="text-sm text-ink-700 dark:text-white/90 space-y-1">
                        {n.highlights.map((h, i) => (
                          <li key={i}>· {h}</li>
                        ))}
                      </ul>
                    ) : (
                      <p class="text-sm text-ink-500 dark:text-white/60">No highlights yet.</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {summaries.length > 0 && (
            <section>
              <h3 class="text-xs font-bold uppercase tracking-wider text-ink-400 dark:text-white/50 mb-2">
                Summaries
              </h3>
              <div class="space-y-1.5">
                {summaries.map((s) => (
                  <div class="card p-4">
                    <div class="text-xs text-ink-400 dark:text-white/50 mb-1">
                      {fmtTime(s.from)} → {fmtTime(s.to)} · {s.count} entries
                    </div>
                    {s.highlights.length > 0 && (
                      <ul class="text-sm text-ink-700 dark:text-white/90 space-y-1 mb-2">
                        {s.highlights.map((h, i) => (
                          <li key={i}>· {h}</li>
                        ))}
                      </ul>
                    )}
                    <div class="text-xs text-ink-500 dark:text-white/60 space-y-0.5">
                      {Object.keys(s.byEntity).length > 0 && (
                        <div>Entities: {topPairs(s.byEntity, 5)}</div>
                      )}
                      {Object.keys(s.byActor).length > 0 && (
                        <div>Actors: {topPairs(s.byActor, 3)}</div>
                      )}
                      {s.sample.length > 0 && (
                        <div class="text-ink-400 dark:text-white/40">… {s.sample.join(" · ")}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {entries.length > 0 && (
            <section>
              <h3 class="text-xs font-bold uppercase tracking-wider text-ink-400 dark:text-white/50 mb-2">
                Recent activity
              </h3>
              <div class="space-y-1.5">
                {entries.map((e) => (
                  <div class="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-ink/[0.06] dark:border-white/[0.06] bg-white dark:bg-ink-800">
                    <span class="h-1.5 w-1.5 rounded-full shrink-0 bg-brand-400" />
                    <span class="text-sm text-ink-700 dark:text-white min-w-0 truncate">{e.summary}</span>
                    <span class="text-xs text-ink-400 dark:text-white/50 shrink-0 ml-auto">{fmtTime(e.eventAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>,
  );
};
