import { Context } from "hono";
import type { User } from "@backend/types";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { Rule } from "wfp-format/rule";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";

export const rulesPanelView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  const ws = databaseId ? getSessionByDatabaseId(databaseId) : null;
  const rules = ws ? ws.getRules() : [];

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="mb-6">
        <h2 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">Rules</h2>
        <p class="text-sm text-ink-500 mb-4">
          Rules and methods for this workspace — report preferences, company policies, and data conventions. Applied in both chat and workflow builds.
        </p>
        <div class="flex items-center gap-2">
          <button
            hx-get="/app/make-rule"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition"
          >
            New Rule
          </button>
          <label class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors cursor-pointer inline-flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 9h10v10H9zM5 5h10v3M5 5v10h3" />
            </svg>
            Copy Rule
            <input
              type="file"
              name="file"
              accept=".wfp,application/json"
              class="hidden"
              hx-post="/app/copy-from-file/upload"
              hx-vals='{"kind":"rule"}'
              hx-encoding="multipart/form-data"
              hx-trigger="change"
              hx-target="#modal-container"
              hx-swap="innerHTML"
            />
          </label>
        </div>
      </div>

      {rules.length === 0 ? (
        <div class="text-center py-12 text-ink-400 dark:text-ink-500">
          <svg class="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
          <p class="text-sm">No rules yet.</p>
          <p class="text-xs mt-2">Add rules and methods — report preferences, company policies, or data conventions.</p>
        </div>
      ) : (
        <div class="flex flex-wrap gap-2" id="rules-list">
          {rules.map((rule) => renderRuleBadge(rule))}
        </div>
      )}
    </div>
  );
};

function renderRuleBadge(rule: Rule) {
  return (
    <button
      hx-get={`/app/rules/${encodeURIComponent(rule.name)}`}
      hx-target="#main-panel"
      hx-swap="innerHTML"
      title={rule.description || rule.name}
      class="pill cursor-pointer transition-colors bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white hover:bg-ink/[0.08] dark:hover:bg-white/[0.1]"
    >
      {rule.name}
    </button>
  );
}

export const rulesDetailView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const name = decodeURIComponent(c.req.param("name"));
  const mode = c.req.query("mode") || "view";

  if (!databaseId || !name) {
    return c.html(<div class="p-6 text-coral-500">Rule not found</div>);
  }

  const ws = getSessionByDatabaseId(databaseId);
  const rule = ws?.getRule(name);
  if (!rule) {
    return c.html(<div class="p-6 text-coral-500">Rule "{name}" not found</div>);
  }

  const bodyContent = rule.content.replace(/^---[\s\S]*?---\n*/, "").trim();

  if (mode === "edit") {
    return c.html(
      <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
        <div class="flex items-center gap-3 mb-4">
          <button
            hx-get={`/app/rules/${encodeURIComponent(rule.name)}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="p-1.5 text-ink-400 hover:text-ink-600 dark:hover:text-white rounded transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </button>
          <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white">Edit: {rule.name}</h2>
        </div>

        <form hx-post="/app/rules/save" hx-target="#main-panel" hx-swap="innerHTML" class="space-y-4">
          <input type="hidden" name="original_name" value={rule.name} />

          <div>
            <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Name</label>
            <input type="text" name="name" value={rule.name}
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Description</label>
            <input type="text" name="description" value={rule.description || ""}
              placeholder="Clear, concise summary of what this rule does"
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Tags (comma-separated)</label>
            <input type="text" name="tags" value={(rule.tags || []).join(", ")} placeholder="accounting, reconciliation"
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-ink-600 dark:text-white/70 mb-1">Content (markdown)</label>
            <textarea name="content" rows={16}
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white font-mono">{rule.content}</textarea>
          </div>

          <div class="flex items-center gap-3">
            <button type="submit" class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition">Save</button>
            <button type="button" hx-get={`/app/rules/${encodeURIComponent(rule.name)}`} hx-target="#main-panel" hx-swap="innerHTML"
              class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition">Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="flex items-center gap-3">
            <button
              hx-get="/app/rules"
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class="p-1.5 text-ink-400 hover:text-ink-600 dark:hover:text-white rounded transition-colors"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
            </button>
            <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white">{rule.name}</h2>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 mt-2 ml-10">
            {rule.tags && rule.tags.map((tag) => (
              <span class="text-xs px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300">{tag}</span>
            ))}
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            hx-get={`/app/rules/${encodeURIComponent(rule.name)}?mode=edit`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-3 py-1.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors flex items-center gap-1.5"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
            Edit
          </button>
          <button
            hx-delete={`/app/rules/${encodeURIComponent(rule.name)}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-confirm={`Delete rule "${rule.name}"?`}
            class="rounded-xl border border-ink/[0.1] hover:border-coral-200 px-3 py-1.5 text-sm font-semibold text-ink-500 hover:text-coral-600 dark:border-white/[0.1] dark:text-white/60 dark:hover:border-coral-800 dark:hover:text-coral-300 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {rule.description && (
        <p class="text-sm text-ink-500 mb-4 ml-10 italic">{rule.description}</p>
      )}

      <div class="card p-6">
        <div
          class="prose prose-sm prose-slate dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(bodyContent) }}
        />
      </div>
    </div>
  );
};

export const rulesSaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const body = await c.req.parseBody();
  const name = (body.name as string || "").trim().replace(/\s+/g, "-").toLowerCase();
  const description = (body.description as string || "").trim();
  const tags = (body.tags as string || "").split(",").map((t) => t.trim()).filter(Boolean);
  const content = (body.content as string || "").trim();
  const originalName = body.original_name as string;

  if (!name || !content) {
    return c.html(<div class="p-6 text-coral-500">Name and content are required.</div>);
  }

  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return c.html(<div class="p-6 text-coral-500">No workspace session.</div>);

  if (originalName && originalName !== name) {
    ws.deleteRule(originalName);
  }

  ws.upsertRule({
    name,
    description: description || undefined,
    tags,
    content,
  });
  return rulesPanelView(c);
};

export const rulesDeleteHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const name = decodeURIComponent(c.req.param("name"));

  if (databaseId && name) {
    const ws = getSessionByDatabaseId(databaseId);
    if (ws) {
      ws.deleteRule(name);
    }
  }

  return rulesPanelView(c);
};
