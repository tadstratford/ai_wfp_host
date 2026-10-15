import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import providersJson from "@backend/core/llm/llm-providers.json";

export const modelInfoHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const { providers } = providersJson as any;

  const configuredKeys = await userManager.listLlmKeys(user.userId);

  const providerList = Object.entries(providers).map(([id, p]: [string, any]) => ({
    id,
    name: p.name,
    freeTier: p.free_tier || false,
    freeTierUrl: p.free_tier_url || null,
    modelCount: (p.models || []).length,
    keyConfigured: configuredKeys.includes(id),
  }));

  return c.json({
    currentProvider: user.llmProvider || "",
    currentModel: user.llmModel || "",
    currentMode: user.currentChatMode || "build",
    hasLegacyKey: !!user.llmApiKey,
    providers: providerList,
  });
};

export const modelInfoRailHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const { providers } = providersJson as any;

  const configuredKeys = await userManager.listLlmKeys(user.userId);
  const providerName = user.llmProvider
    ? ((providers as any)[user.llmProvider]?.name || user.llmProvider)
    : "Default";
  const providerKeyConfigured = user.llmProvider
    ? configuredKeys.includes(user.llmProvider)
    : false;
  // const currentMode = user.currentChatMode || "build";
  // const isPlan = currentMode === "plan";

  const compactModel = (model: string) => {
    if (!model) return "No model";
    if (model.length > 20) return model.slice(0, 18) + "...";
    return model;
  };

  return c.html(
    <div class="p-4" id="model-rail-content">
      <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
        Current Model
      </h3>

      {/* Clickable provider/model — opens model picker modal */}
      <button
        type="button"
        id="rail-model-btn"
        class="w-full text-left bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer border border-transparent hover:border-blue-400 dark:hover:border-blue-500"
        hx-get="/app/api/model-picker"
        hx-target="#modal-container"
        hx-swap="innerHTML"
      >
        <div class="flex items-center gap-2">
          <span class={`w-2 h-2 rounded-full shrink-0 ${providerKeyConfigured ? "bg-green-500" : "bg-yellow-500"}`} />
          <span class="text-sm font-medium text-gray-900 dark:text-white">{providerName}</span>
          <svg class="h-3 w-3 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {compactModel(user.llmModel || "")}
        </div>
      </button>

      {/* Mode toggle — temporarily disabled */}
      {/*
      <div class="mt-3 flex gap-1">
        <button
          type="button"
          class={`flex-1 text-xs font-medium rounded-md py-1.5 transition-colors ${!isPlan ? "bg-blue-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`}
          hx-post="/app/api/chat-mode"
          hx-vals='{"mode":"build"}'
          hx-swap="none"
          hx-trigger="click"
          hx-on--after-request="htmx.ajax('GET','/app/api/model-info-rail',{target:'#model-rail',swap:'innerHTML'})"
        >
          Act
        </button>
        <button
          type="button"
          class={`flex-1 text-xs font-medium rounded-md py-1.5 transition-colors ${isPlan ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"}`}
          hx-post="/app/api/chat-mode"
          hx-vals='{"mode":"plan"}'
          hx-swap="none"
          hx-trigger="click"
          hx-on--after-request="htmx.ajax('GET','/app/api/model-info-rail',{target:'#model-rail',swap:'innerHTML'})"
        >
          Plan
        </button>
      </div>
      */}
    </div>,
  );
};
