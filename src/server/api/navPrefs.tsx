import { Context } from "hono";
import type { User } from "@backend/types";
import { NAV_TOGGLE_ITEMS, DEFAULT_VISIBLE_NAV_KEYS } from "@shared/navItems";
import { userManager } from "@backend/core/admin/userManager";

/**
 * Navigation preference card — rendered into #nav-prefs-card on the /app/user
 * screen (next to the Skills card). Checkboxes toggle which shell nav sections
 * are visible. Self-refreshing: GET /app/api/nav-prefs renders the current
 * state; POST /app/api/nav-prefs saves and re-renders. Saving also triggers a
 * full-page refresh (HX-Refresh) so the shell header nav re-renders.
 */

function navPrefsCard(opts: {
  enabled: string[];
  message?: { type: "success" | "error"; text: string } | null;
}) {
  const { enabled, message } = opts;
  const enabledSet = new Set(enabled);

  return (
    <div id="nav-prefs-card" class="card p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
          Navigation
        </h3>
        <span class="text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
          sections
        </span>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Choose which sections appear in the sidebar. Hidden sections stay
        reachable by their URL.
      </p>

      {message && (
        <div
          class={`text-xs px-3 py-2 rounded-md ${
            message.type === "success"
              ? "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30"
              : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30"
          }`}
        >
          {message.text}
        </div>
      )}

      <form
        hx-post="/app/api/nav-prefs"
        hx-target="#nav-prefs-card"
        hx-swap="outerHTML"
        class="space-y-3"
      >
        {NAV_TOGGLE_ITEMS.map((g) => (
          <label
            key={g.key}
            class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
          >
            <input
              type="checkbox"
              name="items"
              value={g.key}
              checked={enabledSet.has(g.key)}
              class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span class="min-w-0">
              <span class="block text-sm font-medium text-gray-900 dark:text-white">
                {g.label}
              </span>
              <span class="block text-xs text-gray-500 dark:text-gray-400">
                {g.description}
              </span>
            </span>
          </label>
        ))}

        <button
          type="submit"
          class="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Save navigation
        </button>
      </form>
    </div>
  );
}

export const navPrefsCardHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const stored = await userManager.getStoredNavVisibilityByDatabaseId(user.currentDatabaseId);
  const enabled = stored ?? DEFAULT_VISIBLE_NAV_KEYS;
  return c.html(navPrefsCard({ enabled }));
};

export const navPrefsSaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const formData = await c.req.formData();
  const selected = formData.getAll("items").map(String);

  await userManager.saveNavVisibility(user.userId, selected);

  const stored = await userManager.getStoredNavVisibilityByDatabaseId(user.currentDatabaseId);
  const enabled = stored ?? DEFAULT_VISIBLE_NAV_KEYS;

  // The shell header nav is rendered outside this card, so refresh the page to
  // apply the new visibility immediately.
  c.header("HX-Refresh", "true");
  return c.html(
    navPrefsCard({
      enabled,
      message: { type: "success", text: "Navigation updated." },
    }),
  );
};
