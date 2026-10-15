import { Context } from "hono";
import type { User } from "@backend/types";
import { userManager } from "@backend/core/admin/userManager";

/**
 * In-app settings panel — appearance, default model display, connections.
 * Rendered as an HTMX partial for #main-panel.
 *
 * API keys are managed from the model picker on the user screen (not here).
 */
export const settingsPanelView = async (c: Context) => {
  const user = c.get("user") as User;
  const isDark = user.darkMode;
  const secrets = await userManager.listSecrets(user.userId);

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">
        Settings
      </h1>
      <p class="text-sm text-ink-500 mb-8">
        Display preferences and connections. API keys are managed from the model picker on the user screen.
      </p>

      {/* Dark Mode */}
      <section class="mb-10">
        <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">
          Appearance
        </h2>
        <div class="flex items-center justify-between bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3">
          <div>
            <div class="text-sm font-medium text-ink dark:text-white">Dark Mode</div>
            <div class="text-xs text-ink-500">Toggle dark/light appearance</div>
          </div>
          <button
            hx-post="/user/toggle-dark-mode"
            hx-swap="none"
            hx-on--after-request="document.documentElement.classList.toggle('dark');this.querySelector('span').classList.toggle('translate-x-6');this.querySelector('span').classList.toggle('translate-x-1');this.classList.toggle('bg-brand-500');this.classList.toggle('bg-ink-300')"
            class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDark ? "bg-brand-500" : "bg-ink-300 dark:bg-ink-600"}`}
          >
            <span
              class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDark ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>
      </section>

      {/* Connections (Secrets) */}
      <section class="mb-10">
        <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">
          Connections
        </h2>
        <p class="text-xs text-ink-500 mb-4">
          API keys for external services. Used by <code class="bg-ink/[0.05] dark:bg-white/[0.06] px-1 rounded">api.getSecret(name)</code> in workflow tools. To teach the AI how to use an API, create a knowledge pack describing the endpoints and schema. Never included in shared .wfp files.
        </p>

        {secretsListHtml(secrets)}
      </section>
    </div>,
  );
};

const inputClasses = "w-full px-2 py-1.5 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-lg bg-white dark:bg-ink-800 text-ink dark:text-white focus:ring-1 focus:ring-brand-500 focus:border-brand-400";

export function secretsListHtml(secrets: Array<{ name: string }>, error?: string) {
  return (
    <div id="secrets-list" class="space-y-3">
      {error && (
        <p class="text-xs text-coral-600 dark:text-coral-300">{error}</p>
      )}

      {/* Existing secrets */}
      {secrets.map((s, i) => (
        <div class="bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3">
          <div class="flex items-center gap-2">
            <input
              type="text"
              value={s.name}
              readonly
              class={`flex-1 font-mono ${inputClasses} bg-ink/[0.03] dark:bg-white/[0.03] cursor-default`}
            />
            <input
              type="password"
              id={`secret-update-${i}`}
              name="value"
              placeholder="••••••••"
              class={`flex-1 ${inputClasses}`}
            />
            <button
              hx-post="/user/secrets"
              hx-vals={`{"name":"${s.name}"}`}
              hx-include={`#secret-update-${i}`}
              hx-target="#secrets-list"
              hx-swap="outerHTML"
              class="px-3 py-1.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors"
            >
              Save
            </button>
            <button
              hx-post="/user/secrets/delete"
              hx-vals={`{"name":"${s.name}"}`}
              hx-target="#secrets-list"
              hx-swap="outerHTML"
              class="px-3 py-1.5 text-sm font-medium text-coral-600 hover:text-coral-600 dark:text-coral-300 dark:hover:text-coral-300 border border-coral-200 dark:border-coral-800 rounded-lg transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      ))}

      {/* Add row — always visible */}
      <div class="bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3 border-dashed">
        <div class="flex items-center gap-2">
          <input
            type="text"
            id="secret-name"
            name="name"
            placeholder="name (e.g. supabase, fx_api)"
            class={`flex-1 font-mono ${inputClasses}`}
          />
          <input
            type="password"
            id="secret-value"
            name="value"
            placeholder="value"
            class={`flex-1 ${inputClasses}`}
          />
          <button
            hx-post="/user/secrets"
            hx-include="#secret-name, #secret-value"
            hx-target="#secrets-list"
            hx-swap="outerHTML"
            class="px-3 py-1.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors"
          >
            Add
          </button>
          <div class="w-[74px]"></div>
        </div>
      </div>
    </div>
  );
}
