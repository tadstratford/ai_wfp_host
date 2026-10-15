import { Context } from "hono";
import type { User } from "@backend/types";
import {
  listPrivacyEntries,
  setPrivacyEntities,
  clearAutoMask,
  type PrivacyEntry,
} from "@backend/core/knowledge/index";
import { buildAutoMask } from "@backend/core/knowledge/autoMask";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { refreshActiveWorkspaceIfStale } from "@backend/core/workspace/workspaceLifecycle";

const TEXTAREA_CLS =
  "w-full resize-y rounded-xl border border-ink/[0.12] bg-[#F3F5F9] p-3 text-sm font-mono text-ink dark:bg-ink-800 dark:border-white/[0.1] dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition";

function PairTable({ entries }: { entries: PrivacyEntry[] }) {
  if (entries.length === 0) {
    return <p class="text-sm text-ink-400 dark:text-ink-500">No entries yet.</p>;
  }
  return (
    <div class="overflow-x-auto rounded-xl border border-ink/[0.08] dark:border-white/[0.08]">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr class="bg-ink/[0.03] dark:bg-white/[0.04] text-left">
            <th class="px-3 py-2 text-xs font-semibold text-ink-500 dark:text-white/70">Real value</th>
            <th class="px-3 py-2 text-xs font-semibold text-ink-500 dark:text-white/70">Masked value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr class="border-t border-ink/[0.06] dark:border-white/[0.06]">
              <td class="px-3 py-2 font-mono text-ink dark:text-white whitespace-nowrap">{e.real}</td>
              <td class="px-3 py-2 font-mono text-brand-600 dark:text-brand-300 whitespace-nowrap">{e.fake}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Privacy Panel — full-page editor for the privacy map.
 * Two tabs: "Manual" (user-authored entity list) and "Automated" (values
 * discovered from data files on upload). Both produce realistic masked
 * stand-ins (real → fake) so the LLM still sees meaningful data.
 */
async function renderPanel(c: Context, tab: "manual" | "automated"): Promise<Response> {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  // Re-hydrate from Supabase if another machine/instance saved since we last
  // synced (cheap metadata check; no-op when timestamps match).
  if (databaseId) {
    try {
      await refreshActiveWorkspaceIfStale(databaseId);
    } catch (err) {
      console.error("[privacyPanelView] freshness check failed:", err);
    }
  }

  const entries = databaseId ? listPrivacyEntries(databaseId) : [];
  const manual = entries.filter((e) => e.source === "manual");
  const automatic = entries.filter((e) => e.source === "automatic");
  const existing = manual.map((e) => e.real).join("\n");

  const tabBase = "px-3 py-1.5 text-xs font-medium rounded-t-lg";
  const tabActive = `${tabBase} bg-white dark:bg-ink-800 text-brand-600 dark:text-brand-300 border border-b-0 border-ink/[0.08] dark:border-white/[0.08]`;
  const tabInactive = `${tabBase} text-ink-500 dark:text-white/70 hover:text-ink-700`;

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">Privacy Map</h2>
          <p class="text-sm text-ink-500">
            Protect sensitive names from cloud AI.
          </p>
        </div>
      </div>

      <div class="flex gap-1 mb-4">
        <a href="/app/privacy" class={tab === "manual" ? tabActive : tabInactive}>Manual ({manual.length})</a>
        <a href="/app/privacy?tab=automated" class={tab === "automated" ? tabActive : tabInactive}>
          Automated ({automatic.length})
        </a>
      </div>

      {tab === "manual" ? (
        <form hx-post="/app/privacy/save" hx-target="#main-panel" hx-swap="innerHTML">
          <div class="card p-5 mb-4">
            <div class="flex items-center gap-2 text-ink-600 dark:text-white mb-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span class="text-xs font-bold uppercase tracking-wider">How it works</span>
            </div>
            <p class="text-xs text-ink-500 leading-relaxed">
              List names you want to keep private — one per line. <strong>Company names</strong>, <strong>people</strong>, <strong>accounts</strong>, or any sensitive text.
              Before each AI request, these names are swapped for realistic stand-ins (a name stays a name), so the AI sees meaningful data but never the real value. Results are translated back automatically.
            </p>
          </div>

          <div class="card p-5">
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-ink-600 dark:text-white/70">Entity names (one per line)</label>
              <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                {manual.length} {manual.length === 1 ? "name" : "names"} protected
              </span>
            </div>
            <textarea
              name="content"
              rows={12}
              placeholder={"Smithco Industries\nJohn Smith\nJohnson & Partners\nFirst National Bank"}
              class={TEXTAREA_CLS}
            >{existing}</textarea>

            <div class="mt-4 flex items-start gap-2.5 rounded-xl border border-brand-100 bg-brand-50/60 dark:border-brand-900/40 dark:bg-brand-900/20 p-3">
              <svg class="w-4 h-4 mt-0.5 shrink-0 text-brand-500 dark:text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3h18v18H3zM3 9h18M9 3v18" />
              </svg>
              <p class="text-xs text-ink-600 dark:text-white/70 leading-relaxed">
                <strong>Tip:</strong> sensitive values in your data files (emails, phone numbers, SSNs, company
                and person names, addresses) are discovered and masked automatically on upload. List anything
                extra you want protected here.
              </p>
            </div>

            <div class="mt-4 flex justify-end">
              <button
                type="submit"
                class="shrink-0 inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition"
              >
                Save
              </button>
            </div>
          </div>

          <div class="card p-5 mt-4">
            <div class="flex items-center justify-between mb-3">
              <label class="text-xs font-semibold text-ink-600 dark:text-white/70">Masked preview</label>
            </div>
            <PairTable entries={manual} />
          </div>
        </form>
      ) : (
        <div class="space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between mb-2">
              <div>
                <div class="text-sm font-semibold text-ink-600 dark:text-white">Automated masks</div>
                <p class="text-xs text-ink-500 mt-1">
                  Discovered from your data files on upload. Values are swapped for realistic
                  stand-ins before any AI request and translated back in results.
                </p>
              </div>
              <span class="pill shrink-0 whitespace-nowrap bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                {automatic.length} {automatic.length === 1 ? "value" : "values"} masked
              </span>
            </div>

            <div class="flex gap-2">
              <form hx-post="/app/privacy/automate" hx-target="#main-panel" hx-swap="innerHTML">
                <button type="submit" class="inline-flex items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition">
                  Run auto-mask
                </button>
              </form>
              <form hx-post="/app/privacy/automate-clear" hx-target="#main-panel" hx-swap="innerHTML">
                <button type="submit" class="inline-flex items-center gap-2 rounded-xl border border-ink/[0.12] hover:bg-ink-50 dark:hover:bg-ink-800 px-4 py-2 text-sm font-semibold text-ink-600 dark:text-white transition">
                  Clear all
                </button>
              </form>
            </div>
          </div>

          {automatic.length === 0 ? (
            <div class="card p-8 text-center text-sm text-ink-500">
              No automated masks yet. They are built automatically when you upload a data file.
            </div>
          ) : (
            <div class="card p-5">
              <div class="flex items-center justify-between mb-3">
                <label class="text-xs font-semibold text-ink-600 dark:text-white/70">Real value → masked value</label>
              </div>
              <PairTable entries={automatic} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const privacyPanelView = (c: Context) =>
  renderPanel(c, c.req.query("tab") === "automated" ? "automated" : "manual");

/**
 * Save handler — stores the entity list as a knowledge pack with scope "privacy-map".
 * Empty content deletes the pack. Fakes are generated/preserved automatically.
 */
export const privacySaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const body = await c.req.parseBody();
  const content = (body.content as string || "");
  const entities = content
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  setPrivacyEntities(databaseId, entities);

  return renderPanel(c, "manual");
};

/**
 * Run auto-mask over every tabular data file in the workspace.
 */
export const privacyAutomateHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  if (session) {
    // Rebuild from scratch so stale entries (e.g. from a changed classifier) are purged.
    clearAutoMask(databaseId);
    for (const name of session.getDataNames()) {
      const entry = session.getDataEntry(name);
      if (!entry) continue;
      if (entry.content_type === "csv" || entry.content_type === "json_array" || entry.content_type === "json_cells") {
        try {
          buildAutoMask(databaseId, name);
        } catch {
          /* best-effort */
        }
      }
    }
  }

  return renderPanel(c, "automated");
};

/**
 * Clear the automated mask.
 */
export const privacyAutomateClearHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (databaseId) clearAutoMask(databaseId);
  return renderPanel(c, "automated");
};
