import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import providersJson from "@backend/core/llm/llm-providers.json";

/**
 * GET /app/api/key-form?provider=X — inline key entry form for the model picker modal.
 * Swapped into the model picker's #key-panel area.
 */
export const keyFormHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const provider = c.req.query("provider") || "";
  const { providers } = providersJson as any;
  const p = (providers as any)[provider];

  if (!p) {
    return c.html(
      <div class="text-xs text-red-500 p-2">Unknown provider: {provider}</div>,
    );
  }

  const configuredKeys = await userManager.listLlmKeys(user.userId);
  const isConfigured = configuredKeys.includes(provider);

  return c.html(
    <div id="key-panel" class="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 px-2">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
          {p.name} API Key
        </span>
        <button
          type="button"
          id="cancel-key-form"
          class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form
        hx-post="/user/llm-keys"
        hx-vals={JSON.stringify({ provider })}
        hx-include="#key-form-input"
        hx-swap="none"
        hx-on--after-request={
          "htmx.ajax('GET','/app/api/model-picker',{target:'#modal-container',swap:'innerHTML'});"
        }
      >
        <div class="flex items-center gap-2">
          <input
            type="password"
            id="key-form-input"
            name="key"
            placeholder={isConfigured ? "•••••••• (saved)" : "sk-..."}
            class="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
            autofocus
          />
          <button
            type="submit"
            class="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Save
          </button>
        </div>
        {isConfigured && (
          <div class="mt-2">
            <button
              type="button"
              class="text-xs text-red-500 hover:text-red-600 dark:text-red-400 underline"
              hx-post="/user/llm-keys"
              hx-vals={JSON.stringify({ provider, key: "" })}
              hx-swap="none"
              hx-on--after-request={
                "htmx.ajax('GET','/app/api/model-picker',{target:'#modal-container',swap:'innerHTML'});"
              }
            >
              Remove key
            </button>
          </div>
        )}
      </form>

      {p.free_tier && p.free_tier_url && (
        <a
          href={p.free_tier_url}
          target="_blank"
          rel="noopener"
          class="inline-block mt-2 text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 underline"
        >
          Get a free key →
        </a>
      )}
    </div>,
  );
};
