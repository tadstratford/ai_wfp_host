import { Context } from "hono";
import type { User } from "@backend/types";
import { listCapabilities } from "../../capabilities/registry";
import {
  ensureEnabledSkillGroups,
  saveEnabledSkillGroups,
} from "@backend/core/admin/skillGroupsService";

/**
 * Capabilities preference card — rendered into #capabilities-prefs-card on the
 * /app/user screen. Lists every capability (from the capability registry) with
 * its tool count and trust tier. Capabilities that declare a `group` are
 * toggleable (enabled skill group); the rest are core and always-on.
 * Self-refreshing: GET /app/api/capabilities-prefs renders the current state;
 * POST /app/api/capabilities-prefs saves and re-renders.
 */

const TRUST_BADGE: Record<string, string> = {
  core: "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
  integration: "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30",
  external: "text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30",
};

function capabilitiesPrefsCard(opts: {
  enabled: string[];
  message?: { type: "success" | "error"; text: string } | null;
}) {
  const { enabled, message } = opts;
  const enabledSet = new Set(enabled);

  // Toggleable capabilities (those with a group) first, then core (locked).
  const capabilities = listCapabilities().slice().sort((a, b) => {
    const aToggle = a.manifest.group ? 0 : 1;
    const bToggle = b.manifest.group ? 0 : 1;
    return aToggle - bToggle;
  });

  return (
    <div id="capabilities-prefs-card" class="card p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
          Capabilities
        </h3>
        <span class="text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">
          capability
        </span>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Choose which capabilities the assistant can use. Core capabilities are
        always on.
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
        hx-post="/app/api/capabilities-prefs"
        hx-target="#capabilities-prefs-card"
        hx-swap="outerHTML"
        class="space-y-3"
      >
        {capabilities.map((cap) => {
          const m = cap.manifest;
          const trust = m.trust;
          const toolCount = cap.tools.length;

          const title = (
            <span class="block text-sm font-medium text-gray-900 dark:text-white">
              {m.name}
              <span
                class={`ml-2 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full ${TRUST_BADGE[trust] ?? TRUST_BADGE.core}`}
              >
                {trust}
              </span>
            </span>
          );
          const desc = (
            <span class="block text-xs text-gray-500 dark:text-gray-400">
              {m.description} · {toolCount} tool{toolCount === 1 ? "" : "s"}
            </span>
          );

          if (m.group) {
            return (
              <label
                key={m.key}
                class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <input
                  type="checkbox"
                  name="groups"
                  value={m.group.key}
                  checked={enabledSet.has(m.group.key)}
                  class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span class="min-w-0">
                  {title}
                  {desc}
                </span>
              </label>
            );
          }

          return (
            <div
              key={m.key}
              class="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 opacity-80"
            >
              <span class="mt-1.5 h-4 w-4 shrink-0 rounded border border-gray-300 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span class="min-w-0">
                {title}
                {desc}
                <span class="block mt-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  always on
                </span>
              </span>
            </div>
          );
        })}

        <button
          type="submit"
          class="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Save capabilities
        </button>
      </form>
    </div>
  );
}

export const capabilitiesPrefsCardHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const enabled = await ensureEnabledSkillGroups(user.currentDatabaseId);
  return c.html(capabilitiesPrefsCard({ enabled }));
};

export const capabilitiesPrefsSaveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const formData = await c.req.formData();
  const selected = formData.getAll("groups").map(String);

  await saveEnabledSkillGroups(user.userId, user.currentDatabaseId, selected);

  const enabled = await ensureEnabledSkillGroups(user.currentDatabaseId);
  return c.html(
    capabilitiesPrefsCard({
      enabled,
      message: { type: "success", text: "Capabilities updated." },
    }),
  );
};
