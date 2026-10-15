import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import providersJson from "@backend/core/llm/llm-providers.json";

/**
 * GET /app/api/model-picker — modal for selecting provider + model.
 * Rendered into #modal-container. Uses modalHelpers.js for cancel/close.
 */
export const modelPickerHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const { providers } = providersJson as any;

  const configuredKeys = await userManager.listLlmKeys(user.userId);
  const currentProvider = user.llmProvider || "";
  const currentModel = user.llmModel || "";

  const providerEntries = Object.entries(providers) as [string, any][];

  return c.html(
    <div
      id="model-picker-modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">Change Model</h2>
          <button
            type="button"
            id="cancel-model-picker"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
          {providerEntries.map(([id, p]: [string, any]) => {
            const isConfigured = configuredKeys.includes(id);
            const models = p.models || [];

            return (
              <div class="mb-3 last:mb-0">
                <div class="flex items-center gap-2 px-2 py-1">
                  <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${isConfigured ? "bg-green-500" : "bg-gray-400"}`} />
                  <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {p.name}
                  </span>
                  {!isConfigured && (
                    <button
                      type="button"
                      class="text-[10px] text-yellow-500 hover:text-yellow-600 ml-auto"
                      hx-get={`/app/api/key-form?provider=${id}`}
                      hx-target="#key-panel"
                      hx-swap="innerHTML"
                    >
                      set key
                    </button>
                  )}
                  {isConfigured && (
                    <button
                      type="button"
                      class="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ml-auto"
                      title="Update key"
                      hx-get={`/app/api/key-form?provider=${id}`}
                      hx-target="#key-panel"
                      hx-swap="innerHTML"
                    >
                      <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  )}
                </div>
                {models.map((m: any) => {
                  const isSelected = currentProvider === id && currentModel === m.id;
                  return (
                    <button
                      type="button"
                      class={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-md text-sm transition-colors ${isSelected ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium" : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                      hx-post="/app/api/model-prefs"
                      hx-vals={JSON.stringify({ provider: id, model: m.id })}
                      hx-swap="none"
                      hx-on--after-request={
                        "var mc=document.getElementById('modal-container');" +
                        "if(mc){mc.innerHTML='';mc.classList.add('hidden');}" +
                        "htmx.ajax('GET','/app/api/model-info-rail',{target:'#model-rail',swap:'innerHTML'});"
                      }
                    >
                      <span class="flex-1 truncate">{m.name}</span>
                      {isSelected && (
                        <svg class="h-4 w-4 shrink-0 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span class="text-[10px] text-gray-400 dark:text-gray-600 shrink-0 w-10 text-right">
                        {m.contextWindow >= 1000 ? `${Math.round(m.contextWindow / 1000)}k` : `${m.contextWindow}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Key form panel — swapped in by key button clicks */}
        <div id="key-panel"></div>
      </div>
    </div>,
  );
};
