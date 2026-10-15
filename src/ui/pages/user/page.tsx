import { Context } from "hono";

/**
 * User screen — rendered into #main-panel from the shell badge. The main
 * column is intentionally blank for now (token usage + purchasing info will
 * live here); the right rail holds the Current Model card, shared with the
 * model picker via #model-rail.
 */
export const userScreenView = async (c: Context) => {
  return c.html(
    <div class="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
        <div class="min-w-0 space-y-6">
          {/* Capabilities — self-refreshing card (checked = capabilities the assistant can use). */}
          <div
            id="capabilities-prefs-card"
            hx-get="/app/api/capabilities-prefs"
            hx-trigger="load"
            hx-swap="outerHTML"
          >
            <div class="card p-5 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
          </div>

          {/* Navigation — self-refreshing card (checked = shell nav sections shown). */}
          <div
            id="nav-prefs-card"
            hx-get="/app/api/nav-prefs"
            hx-trigger="load"
            hx-swap="outerHTML"
          >
            <div class="card p-5 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
          </div>
        </div>

        {/* Right rail */}
        <aside class="space-y-6">
          {/* Model / provider — self-refreshing rail (opens model picker + key management). */}
          <div class="card overflow-hidden">
            <div id="model-rail" hx-get="/app/api/model-info-rail" hx-trigger="load" hx-swap="innerHTML">
              <div class="p-4 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
            </div>
          </div>

          {/* QuickBooks connection — self-refreshing card (connect/disconnect per login). */}
          <div
            id="qbo-status-card"
            hx-get="/app/api/qbo-status"
            hx-trigger="load"
            hx-swap="outerHTML"
          >
            <div class="card p-5 text-sm text-ink-400 dark:text-ink-500">Loading…</div>
          </div>
        </aside>
      </div>
    </div>,
  );
};
