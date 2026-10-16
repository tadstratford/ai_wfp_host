import type { FC } from "hono/jsx";
import { Context } from "hono";
import type { User } from "@backend/types";
import { listSavedPrompts, addSavedPrompt, deleteSavedPrompt } from "@backend/core/workspace/savedPrompts";
import { flushActiveWorkspace } from "@backend/core/workspace/workspaceLifecycle";

export const SavedPrompts: FC<{ prompts: { id: string; prompt: string; created_at: string }[] }> = ({ prompts }) => {
  return (
    <details class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-ink-900/40 p-4">
      <summary class="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
        Saved prompts
      </summary>
      {prompts.length === 0 ? (
        <p class="text-xs text-ink-400 dark:text-ink-500 mt-3">No saved prompts yet.</p>
      ) : (
        <ul class="space-y-1.5 mt-3">
          {prompts.map((p) => (
            <li key={p.id} class="group flex items-center gap-1">
              <button
                type="button"
                data-prompt={JSON.stringify(p.prompt)}
                onclick="appendToComposer(this)"
                title={p.prompt}
                class="flex-1 min-w-0 text-left text-sm text-ink-700 dark:text-white/80 truncate rounded-lg px-2 py-1.5 hover:bg-ink/[0.05] dark:hover:bg-white/[0.06] transition-colors"
              >
                {p.prompt}
              </button>
              <button
                type="button"
                hx-post={`/sessions/api/delete-saved-prompt?id=${encodeURIComponent(p.id)}`}
                hx-target="#saved-prompts"
                hx-swap="innerHTML"
                title="Delete prompt"
                aria-label="Delete prompt"
                class="shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 flex h-6 w-6 items-center justify-center rounded-md text-ink-400 dark:text-white/50 hover:text-coral-600 dark:hover:text-coral-300 hover:bg-ink/[0.06] dark:hover:bg-white/[0.08] transition-colors"
              >
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
};

/**
 * GET /sessions/api/saved-prompts — re-render the saved prompts panel body.
 */
export const savedPromptsHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const prompts = databaseId ? listSavedPrompts(databaseId) : [];
  return c.html(<SavedPrompts prompts={prompts} />);
};

/**
 * POST /sessions/api/save-prompt — save the composer's current text as a saved
 * prompt. Returns the updated panel so the right rail refreshes in place.
 */
export const savePromptHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const body = await c.req.parseBody();
  const message = (body.message as string || "").trim();

  if (!databaseId) return c.html(<SavedPrompts prompts={[]} />);
  if (message) addSavedPrompt(databaseId, message);
  await flushActiveWorkspace(databaseId);

  return c.html(<SavedPrompts prompts={listSavedPrompts(databaseId)} />);
};

/**
 * POST /sessions/api/delete-saved-prompt?id=… — remove one saved prompt.
 */
export const deleteSavedPromptHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const id = c.req.query("id") || "";

  if (databaseId && id) {
    deleteSavedPrompt(databaseId, id);
    await flushActiveWorkspace(databaseId);
  }

  return c.html(<SavedPrompts prompts={databaseId ? listSavedPrompts(databaseId) : []} />);
};
