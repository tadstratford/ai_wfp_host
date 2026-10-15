import { userManager } from "@backend/core/admin/userManager";
import { decrypt } from "@backend/core/crypto";
import { realId } from "@backend/core/workspace/emailInbox/identity";

/** Provider → server-side environment variable holding a proxied API key. */
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openrouter_jev: "OPENROUTER_JEV_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

/** Server-side key for a provider, if configured. Used when a user brings none. */
function getServerEnvKey(provider: string): string | undefined {
  const envName = PROVIDER_API_KEY_ENV[provider.toLowerCase()];
  const specific = envName ? process.env[envName] || undefined : undefined;
  if (specific) return specific;
  const llmProvider = (process.env.LLM_API_PROVIDER || "").trim().toLowerCase();
  if (llmProvider && llmProvider === provider.toLowerCase() && process.env.LLM_API_KEY) {
    return process.env.LLM_API_KEY;
  }
  return undefined;
}

/**
 * Look up a user's decrypted LLM API key for a specific provider.
 * Priority: user's per-provider key → user's legacy key → server env key.
 */
export async function getLlmApiKeyForProvider(
  userId: string,
  provider: string,
): Promise<{ key?: string; source: "user_provider" | "user_legacy" | "server" | "none" }> {
  userId = realId(userId);

  if (provider === "ollama") {
    return { key: undefined, source: "none" };
  }

  const userProviderKey = await userManager.getLlmKey(userId, provider);
  if (userProviderKey) {
    return { key: userProviderKey, source: "user_provider" };
  }

  // One-key BYO: the Classifier (openrouter_jev) shares the user's OpenRouter
  // key when they've only stored one.
  if (provider === "openrouter_jev") {
    const openrouterKey = await userManager.getLlmKey(userId, "openrouter");
    if (openrouterKey) {
      return { key: openrouterKey, source: "user_provider" };
    }
  }

  const config = await userManager.getLlmConfigByDatabaseId(userId);
  if (config?.encrypted_llm_api_key) {
    const legacyKey = decrypt(config.encrypted_llm_api_key);
    if (legacyKey) {
      return { key: legacyKey, source: "user_legacy" };
    }
  }

  const serverKey = getServerEnvKey(provider);
  if (serverKey) {
    return { key: serverKey, source: "server" };
  }

  return { key: undefined, source: "none" };
}

/**
 * Resolve the Classifier (Jev) key — used by both the chat front-door router
 * and the `judge_data` tool. Priority: user's per-provider key
 * (`llm_key_openrouter_jev` → `llm_key_openrouter`) → server env
 * (`OPENROUTER_JEV_API_KEY` → `CLASSIFIER_KEY`). Throws when none is present
 * (no silent fallback).
 */
export async function getClassifierKey(userId: string): Promise<string> {
  const { key } = await getLlmApiKeyForProvider(userId, "openrouter_jev");
  if (key) return key;
  const classifierKey = process.env.CLASSIFIER_KEY;
  if (classifierKey) return classifierKey;
  throw new Error(
    "No Classifier API key configured. Set CLASSIFIER_KEY or OPENROUTER_JEV_API_KEY, or add a Classifier key in Settings.",
  );
}

/**
 * Look up a user's decrypted LLM API key by their app database_id.
 * Returns undefined if no key is stored.
 */
export async function getLLMApiKeyByDatabaseId(databaseId: string): Promise<string | undefined> {
    const row = await userManager.getLlmConfigByDatabaseId(realId(databaseId));
    if (!row?.encrypted_llm_api_key) return undefined;
    return decrypt(row.encrypted_llm_api_key) || undefined;
}

/**
 * Look up a user's full LLM config (provider, model, apiKey) by their app database_id.
 * When userId is provided, looks up per-provider key first, then legacy key.
 * No env var or hardcoded fallbacks.
 */
export async function getLLMConfigByDatabaseId(
  databaseId: string,
  userId?: string,
): Promise<{
    provider: string;
    model: string;
    apiKey?: string;
    userId?: string;
    usingServerKey: boolean;
}> {
    const row = await userManager.getLlmConfigByDatabaseId(realId(databaseId));

    const provider = row?.llm_provider || process.env.LLM_API_PROVIDER || "";
    const model = row?.llm_model || process.env.LLM_MODEL || "";

    if (userId && provider) {
      const keyResult = await getLlmApiKeyForProvider(realId(userId), provider);
      return {
        provider,
        model,
        apiKey: keyResult.key,
        userId: row?.user_id || undefined,
        usingServerKey: keyResult.source === "server",
      };
    }

    const userApiKey = row?.encrypted_llm_api_key
        ? decrypt(row.encrypted_llm_api_key) || undefined
        : undefined;

    return {
        provider,
        model,
        apiKey: userApiKey || getServerEnvKey(provider),
        userId: row?.user_id || undefined,
        usingServerKey: !userApiKey && !!getServerEnvKey(provider),
    };
}
