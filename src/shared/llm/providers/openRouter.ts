/**
 * OpenRouter Provider — OpenAI-compatible endpoint with privacy routing.
 *
 * OpenRouter is OpenAI-compatible (chat/completions), so this wraps the shared
 * `callOpenAICompatible` adapter and adds:
 *   - HTTP-Referer / X-OpenRouter-Title headers (app identification)
 *   - `provider.data_collection = "deny"` by default (privacy-first routing)
 *   - `provider.zdr = true` when a model opts into Zero Data Retention
 *   - `provider.only = [...]` when a model pins to specific providers (US-ZDR)
 *   - authoritative per-call cost parsing (`usage.cost` / `total_cost`)
 *
 * Model-level routing flags (`zdr`, `dataCollection`, `providers`) are read
 * from llm-providers.json at load.
 */

import * as fs from "fs";
import * as path from "path";
import { callOpenAICompatible } from "./deepseek";
import type { ProviderRequest, ProviderResponse } from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Model routing flags (loaded once from llm-providers.json) ────────────────

interface ModelRoutingFlags {
  zdr?: boolean;
  dataCollection?: "deny" | "allow";
  providers?: string[];
}

const modelFlags = new Map<string, ModelRoutingFlags>();

try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "llm-providers.json"), "utf-8"),
  );
  const providers = raw.providers ?? {};
  const openrouter = providers.openrouter ?? {};
  for (const m of openrouter.models ?? []) {
    const flags: ModelRoutingFlags = {};
    if (m.zdr) flags.zdr = true;
    if (m.dataCollection) flags.dataCollection = m.dataCollection;
    if (Array.isArray(m.providers) && m.providers.length > 0) {
      flags.providers = m.providers.map((p: string) => p);
    }
    modelFlags.set(m.id, flags);
  }
} catch {
  console.warn("[openrouter] Could not load llm-providers.json for routing flags");
}

function routingForModel(model: string): Record<string, unknown> {
  const flags = modelFlags.get(model) ?? {};
  const routing: Record<string, unknown> = {
    data_collection: flags.dataCollection ?? "deny",
  };
  if (flags.zdr) {
    routing.zdr = true;
  }
  if (flags.providers && flags.providers.length > 0) {
    routing.only = flags.providers;
  }
  return routing;
}

export interface OpenRouterCallResult extends ProviderResponse {
  providerResponseId?: string;
  rawRequest?: string;
  rawResponse?: string;
}

export async function callOpenRouter(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<OpenRouterCallResult> {
  const extraHeaders: Record<string, string> = {};
  const siteUrl = process.env.OPENROUTER_SITE_URL || "";
  const appTitle = process.env.OPENROUTER_APP_TITLE || process.env.SERVER || "Workflow People";
  if (siteUrl) extraHeaders["HTTP-Referer"] = siteUrl;
  extraHeaders["X-OpenRouter-Title"] = appTitle;

  return callOpenAICompatible(apiKey, model, request, {
    baseUrl: OPENROUTER_BASE_URL,
    extraHeaders,
    providerRouting: routingForModel(model),
    parseCost: true,
  });
}
