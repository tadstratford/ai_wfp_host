import { Context } from "hono";
import type { User } from "@backend/types";
import { Mark } from "@frontend/components/logo";
import { SERVER_NAME } from "@backend/core/settings/instanceConfig";
import { EDITION } from "@shared/edition";
import { shouldEnforceCredit } from "@shared/llm/billing";

/**
 * Account screen — standalone, no open workspace required (GET /app/account).
 * Shows usage + credit balance (and, later, billing history + API keys),
 * separated from the in-workspace /app/user settings screen. Reached via the
 * user button in the /app/workspaces header.
 */
export const accountStandaloneView = async (c: Context) => {
  const user = c.get("user") as User;

  return c.html(
    <html lang="en" class={user.darkMode ? "dark" : ""}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Account — {SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <link rel="stylesheet" href="/public/css/home.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="/public/js/modalHelpers.js"></script>
      </head>
      <body
        class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <header class="flex items-center justify-between h-12 px-4 md:px-6 border-b border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900">
          <a href="/app" class="inline-flex items-center gap-2 no-underline">
            <Mark size={22} />
            <span class="text-sm font-bold tracking-wide text-ink dark:text-white">
              {SERVER_NAME}
            </span>
          </a>
          <div class="flex items-center gap-3">
            {user.userEmail && (
              <span class="hidden sm:inline text-xs text-ink-400 dark:text-ink-500 truncate max-w-[200px]" title={user.userEmail}>
                {user.userEmail}
              </span>
            )}
            {EDITION !== "local" && (
              <a
                href="/auth/logout"
                class="inline-flex items-center gap-1.5 text-sm text-ink-600 dark:text-white/70 hover:text-ink dark:hover:text-white no-underline"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                </svg>
                Log out
              </a>
            )}
          </div>
        </header>

        <main class="max-w-[960px] mx-auto px-4 md:px-8 py-6 md:py-8">
          <h1 class="text-xl font-bold text-ink dark:text-white mb-6">Account</h1>

          <div class="space-y-6">
            {/* Beta credit — self-refreshing card (balance + code redemption).
                Only shown in `credits` mode (hosted); enterprise/admin_pays and
                local bring their own keys and have no credit pool. */}
            {shouldEnforceCredit() && (
              <div
                id="credit-card"
                hx-get="/app/api/credit-status"
                hx-trigger="load"
                hx-swap="outerHTML"
              >
                <div class="card p-5 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
              </div>
            )}

            {/* Usage analytics — self-refreshing panel (spend/tokens/requests + chart). */}
            <div
              id="usage-panel"
              hx-get="/app/api/usage-panel?granularity=day"
              hx-trigger="load"
              hx-swap="outerHTML"
            >
              <div class="card p-5 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
            </div>
          </div>
        </main>

        {/* Modal container for HTMX swaps (matches the app shells) */}
        <div
          id="modal-container"
          class="fixed inset-0 z-50 hidden"
          hx-on--after-swap="this.classList.remove('hidden')"
          hx-on--before-swap="if(event.detail.xhr.responseText === '') this.classList.add('hidden')"
        ></div>
      </body>
    </html>,
  );
};
