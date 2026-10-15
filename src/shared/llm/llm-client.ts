/**
 * Generic LLM Client
 *
 * Provider-agnostic LLM client. No SDK dependency — uses raw fetch
 * via provider adapters in ./providers/.
 *
 * Input: system prompt + messages + options
 * Output: { text, data, usage }
 */

import { writeLLMLog } from "./llm-logger";
import { callAnthropic } from "./providers/anthropic";
import { callDeepSeek } from "./providers/deepseek";
import { callOpenRouter } from "./providers/openRouter";
import type { ProviderRequest, ProviderResponse } from "./providers/types";

// ── Types (all exported — 11+ callers depend on these) ───────────────────────

export interface LLMClientConfig {
  /** Provider ID (e.g. "anthropic", "deepseek", "openai", "ollama") */
  provider: string;
  /** Model ID (e.g. "claude-sonnet-4-6", "deepseek-chat") */
  model: string;
  /** API key — overrides the env var if provided */
  apiKey?: string;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMCallOptions {
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** "json" instructs the model to respond with valid JSON only */
  responseFormat?: "text" | "json";
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMCallResult {
  /** Raw text response from the model */
  text: string;
  /** Parsed JSON if responseFormat was "json", otherwise null */
  data: any | null;
  /** Token usage for cost tracking */
  usage: LLMTokenUsage;
  /** Model ID that was used */
  model: string;
  /** Authoritative per-call cost in USD (returned by OpenRouter). */
  costUsd?: number;
}

// ── Provider env key map ─────────────────────────────────────────────────────

// ── Main call function ───────────────────────────────────────────────────────

/**
 * Call any LLM provider with a unified interface.
 *
 * @param config - provider, model, optional apiKey
 * @param opts   - systemPrompt, messages, maxTokens, temperature, responseFormat
 * @returns      - { text, data, usage, model }
 */
export async function callLLM(
  config: LLMClientConfig,
  opts: LLMCallOptions,
): Promise<LLMCallResult> {
  const startTime = Date.now();
  const providerKey = config.provider.toLowerCase();
  const apiKey = config.apiKey || "";

  if (!apiKey && providerKey !== "ollama") {
    throw new Error(
      `No API key for provider "${providerKey}". Pass apiKey in config.`,
    );
  }

  // Build the normalized provider request
  const messages = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const providerRequest: ProviderRequest = {
    system: opts.systemPrompt,
    messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    responseFormat: opts.responseFormat,
  };

  // Dispatch to the correct provider adapter
  let response: ProviderResponse;
  switch (providerKey) {
    case "anthropic":
      response = await callAnthropic(apiKey, config.model, providerRequest);
      break;
    case "deepseek":
    case "openai":
    case "together":
      response = await callDeepSeek(apiKey, config.model, providerRequest);
      break;
    case "openrouter":
      response = await callOpenRouter(apiKey, config.model, providerRequest);
      break;
    default:
      throw new Error(
        `Unsupported provider: "${providerKey}". Only "anthropic" and "deepseek" are supported.`,
      );
  }

  // Parse JSON if requested
  let data: any = null;
  if (opts.responseFormat === "json" && response.text) {
    data = extractJSON(response.text);
  }

  const result: LLMCallResult = {
    text: response.text,
    data,
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
    },
    model: config.model,
    costUsd: response.costUsd,
  };

  // Write debug log to filesystem
  writeLLMLog({
    provider: config.provider,
    model: config.model,
    systemPrompt: opts.systemPrompt,
    messages: opts.messages,
    response: { text: result.text, usage: result.usage, data: result.data },
    durationMs: Date.now() - startTime,
  });

  return result;
}

// ── JSON extraction ──────────────────────────────────────────────────────────

/**
 * Extract a JSON object from LLM text that may contain prose before/after.
 * Handles: pure JSON, code-fenced JSON, and JSON embedded in explanatory text.
 * Returns null if no valid JSON found.
 */
export function extractJSON(text: string): any | null {
  // Try 1: Direct parse (clean JSON response)
  try {
    return JSON.parse(text.trim());
  } catch {
    /* continue */
  }

  // Try 2: Strip code fences
  const fenced = text
    .replace(/^```json?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* continue */
  }

  // Try 3: Find the outermost { ... } in the text
  const firstBrace = text.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(firstBrace, i + 1));
          } catch {
            /* malformed — continue */
          }
          break;
        }
      }
    }
  }

  return null;
}

// ── Convenience: resolve config from env vars ────────────────────────────────

/**
 * Build an LLMClientConfig from overridden settings.
 * No fallbacks — caller must provide explicit values.
 */
export function resolveConfig(overrides?: {
  provider?: string;
  model?: string;
  apiKey?: string;
}): LLMClientConfig {
  return {
    provider: overrides?.provider || "",
    model: overrides?.model || "",
    apiKey: overrides?.apiKey,
  };
}

/**
 * Build config from a user's saved settings (provider/model/apiKey).
 * Used by chat handlers that have access to the user context.
 */
export function resolveUserConfig(user: {
  llmProvider?: string;
  llmModel?: string;
  llmApiKey?: string;
}): LLMClientConfig {
  return resolveConfig({
    provider: user.llmProvider,
    model: user.llmModel,
    apiKey: user.llmApiKey,
  });
}

// ── Clean LLM code responses ─────────────────────────────────────────────────

/**
 * Strip markdown fences and prose preambles from LLM-generated code.
 * Handles: ```js...```, prose before code, trailing explanations.
 */
export function cleanLLMCodeResponse(raw: string): string {
  let code = raw.trim();

  // If the response contains a fenced code block, extract just its content
  const fenceMatch = code.match(
    /```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/i,
  );
  if (fenceMatch) {
    code = fenceMatch[1].trim();
    return code;
  }

  // Strip leading/trailing fences without content match (partial fences)
  code = code
    .replace(/^```(?:javascript|js|typescript|ts)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  // Strip prose preamble: if the code doesn't start with a JS-like token,
  // find the first line that looks like code
  if (
    code &&
    !/^(?:\/\/|\/\*|const |let |var |async |function |try |if |for |while |switch |return |await |{|\[|"|'|`)/.test(
      code,
    )
  ) {
    const lines = code.split("\n");
    const codeStart = lines.findIndex((l) =>
      /^(?:\/\/|\/\*|const |let |var |async |function |try |if |for |while |switch |return |await |{|\[|"|'|`)/.test(
        l.trim(),
      ),
    );
    if (codeStart > 0) {
      code = lines.slice(codeStart).join("\n").trim();
    }
  }

  return code;
}
