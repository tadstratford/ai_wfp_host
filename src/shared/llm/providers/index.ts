/**
 * Provider Dispatcher — the single entry point for all LLM API calls.
 *
 * Resolves provider/model/apiKey internally from the admin_users table.
 * When sessionId is provided, writes an LLMLogEntry and returns the logId.
 *
 * NO FALLBACKS: if the user has no provider/model/key configured, throw.
 * Never silently fall back to env vars, defaults, or a different provider.
 */

import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { writeLog } from "@backend/core/workspace/logs";
import { logUsage } from "../usageTracker";
import { enforceCredit } from "../credit";
import { shouldEnforceCredit } from "../billing";
import type { LLMLogEntry } from "wfp-format/logs";
import type { ProviderRequest, ProviderResponse, ResolvedConfig } from "./types";
import { callAnthropic } from "./anthropic";
import { callDeepSeek } from "./deepseek";
import { callOpenRouter } from "./openRouter";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import {
  discoverRequestValues,
  hasToolResultBlocks,
} from "@backend/core/knowledge/autoMask";
import {
  maskCallOptions,
  unmaskResult,
  writePrivacyLog,
} from "@backend/core/models/privacyMask";

export type { ProviderRequest, ProviderResponse, ResolvedConfig } from "./types";
export type {
  ProviderMessage,
  ProviderToolSchema,
  ProviderContentBlock,
} from "./types";

// ── Log hook ──────────────────────────────────────────────────────────────────

export interface LogHookParams {
  logId: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  phase?: string;
  iteration?: number;
  kind?: "llm" | "jev";
}

export type LogHook = (params: LogHookParams) => Promise<void>;

let logHook: LogHook | null = null;

export function setLogHook(hook: LogHook | null) {
  logHook = hook;
}

/** Invoke the registered log hook (used by the Jev path, which is not a chat LLM call). */
export async function fireLogHook(params: LogHookParams): Promise<void> {
  if (logHook) await logHook(params);
}

// ── Config resolution ────────────────────────────────────────────────────────

/**
 * Resolve provider/model/apiKey from the admin_users table.
 * API key tiers: per-user key → legacy key → server env key. Throws if
 * provider/model/key are all missing.
 */
export async function resolveConfig(
  databaseId: string,
  opts?: { providerOverride?: string; modelOverride?: string; userId?: string },
): Promise<ResolvedConfig> {
  const cfg = await getLLMConfigByDatabaseId(databaseId, opts?.userId);

  const provider = (opts?.providerOverride || cfg.provider || "").toLowerCase();
  const model = opts?.modelOverride || cfg.model || "";
  const apiKey = cfg.apiKey || "";

  if (!provider) {
    throw new Error(
      "No LLM provider configured. Open your account (click your avatar, top-right) and select a provider and model.",
    );
  }
  if (!model) {
    throw new Error(
      `No LLM model configured for provider "${provider}". Open your account (click your avatar, top-right) and select a model.`,
    );
  }
  if (!apiKey && provider !== "ollama") {
    throw new Error(
      `No API key configured for "${provider}". Open your account (click your avatar, top-right) and set your key.`,
    );
  }

  return { provider, model, apiKey, userId: cfg.userId, usingServerKey: cfg.usingServerKey };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function callProvider(
  databaseId: string,
  request: ProviderRequest,
  opts?: {
    sessionId?: string;
    mode?: string;
    providerOverride?: string;
    modelOverride?: string;
    userId?: string;
    phase?: string;
    iteration?: number;
  },
): Promise<ProviderResponse & { logId?: string; provider?: string; model?: string }> {
  const config = await resolveConfig(databaseId, {
    providerOverride: opts?.providerOverride,
    modelOverride: opts?.modelOverride,
    userId: opts?.userId,
  });
  const startTime = Date.now();

  // Beta credit hard-block for server-key users (operator pays), only when
  // billing mode is `credits`. BYO-key users and `admin_pays`/`none` modes are
  // never gated.
  if (config.usingServerKey && config.userId && shouldEnforceCredit()) {
    await enforceCredit(config.userId);
  }

  const originalRequest = request;
  let privacyMap = loadPrivacyMap(databaseId);
  let substitutionCount = 0;
  let maskedSystemPrompt: string | undefined;
  let maskedMessages: Array<{ role: string; content: string }> | undefined;

  // Catch-up discovery: tool results can carry names the data-load pass never
  // saw (QBO, external MCP). Add them to the automated map, then mask with the
  // enlarged map so the very request that revealed them is protected.
  if (hasToolResultBlocks(request)) {
    const { added } = discoverRequestValues(databaseId, request);
    if (added > 0) privacyMap = loadPrivacyMap(databaseId);
  }

  if (privacyMap) {
    const masked = maskCallOptions(request, privacyMap);
    request = masked.opts;
    substitutionCount = masked.substitutionCount;
    maskedSystemPrompt = typeof request.system === "string" ? request.system : undefined;
    maskedMessages = Array.isArray(request.messages)
      ? request.messages.map((m: any) => ({
          role: typeof m.role === "string" ? m.role : "unknown",
          content:
            typeof m.content === "string"
              ? m.content
              : Array.isArray(m.content)
                ? m.content
                    .map((b: any) => b.text || b.content || "")
                    .filter(Boolean)
                    .join("\n")
                : String(m.content ?? ""),
        }))
      : undefined;
  }

  let response: ProviderResponse & {
    providerResponseId?: string;
    rawRequest?: string;
    rawResponse?: string;
  };

  try {
    switch (config.provider) {
      case "anthropic":
        response = await callAnthropic(config.apiKey, config.model, request);
        break;
      case "deepseek":
        response = await callDeepSeek(config.apiKey, config.model, request);
        break;
      case "openrouter":
        response = await callOpenRouter(config.apiKey, config.model, request);
        break;
      default:
        throw new Error(
          `Unsupported provider: "${config.provider}". Only "anthropic", "deepseek", and "openrouter" are supported.`,
        );
    }
  } catch (err: any) {
    if (opts?.sessionId) {
      const entry = buildLogEntry({
        sessionId: opts.sessionId,
        provider: config.provider,
        model: config.model,
        mode: opts?.mode ?? "",
        system: originalRequest.system,
        messages: originalRequest.messages,
        maskedSystemPrompt,
        maskedMessages,
        substitutionCount,
        startTime,
        success: false,
        error: err.message || String(err),
      });
      tryWriteLog(databaseId, entry);
    }
    logUsage(
      databaseId,
      opts?.mode || "chat",
      config.model,
      { inputTokens: 0, outputTokens: 0 },
      {
        provider: config.provider,
        success: false,
        errorMessage: err.message || String(err),
      },
    );
    throw err;
  }

  const responseTextMasked = typeof response.text === "string" ? response.text : undefined;
  const toolCallsMasked = response.toolCall
    ? [{ name: response.toolCall.name, args: response.toolCall.args }]
    : undefined;

  if (privacyMap) {
    response = unmaskResult(response, privacyMap);
  }

  logUsage(databaseId, opts?.mode || "chat", config.model, response.usage, {
    provider: config.provider,
    costUsd: response.costUsd,
  });

  let logId: string | undefined;
  if (opts?.sessionId) {
    const entry = buildLogEntry({
      sessionId: opts.sessionId,
      provider: config.provider,
      model: config.model,
      mode: opts?.mode ?? "",
      system: originalRequest.system,
      messages: originalRequest.messages,
      maskedSystemPrompt,
      maskedMessages,
      responseTextMasked,
      substitutionCount,
      toolCallsMasked,
      startTime,
      success: true,
      responseText: response.text,
      toolCalls: response.toolCall
        ? [{ name: response.toolCall.name, args: response.toolCall.args }]
        : [],
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      providerResponseId: response.providerResponseId,
      rawRequest: response.rawRequest,
      rawResponse: response.rawResponse,
    });
    tryWriteLog(databaseId, entry);
    logId = entry.id;

    if (logHook) {
      await logHook({
        logId,
        provider: config.provider,
        model: config.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        phase: opts?.phase,
        iteration: opts?.iteration,
        kind: "llm",
      });
    }
  }

  if (privacyMap && substitutionCount > 0) {
    writePrivacyLog(opts?.mode ?? "llm", substitutionCount, privacyMap.size, request);
  }

  return {
    ...response,
    logId,
    provider: config.provider,
    model: config.model,
  };
}

// ── Audit log helpers ────────────────────────────────────────────────────────

function buildLogEntry(params: {
  sessionId: string;
  provider: string;
  model: string;
  mode: string;
  system: string;
  messages: any[];
  maskedSystemPrompt?: string;
  maskedMessages?: Array<{ role: string; content: string }>;
  responseTextMasked?: string;
  substitutionCount?: number;
  toolCallsMasked?: Array<{ name: string; args: unknown }>;
  startTime: number;
  success: boolean;
  responseText?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
  providerResponseId?: string;
  rawRequest?: string;
  rawResponse?: string;
  kind?: "llm" | "jev";
}): LLMLogEntry {
  const logMessages = params.messages.map((m: any) => ({
    role: typeof m.role === "string" ? m.role : "unknown",
    content:
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .map((b: any) => b.text || b.content || "")
              .filter(Boolean)
              .join("\n")
          : String(m.content ?? ""),
  }));

  return {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    mode: params.mode,
    kind: params.kind ?? "llm",
    durationMs: Date.now() - params.startTime,
    systemPrompt: params.system,
    messages: logMessages,
    responseText: params.responseText ?? "",
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    toolCalls: params.toolCalls ?? [],
    success: params.success,
    error: params.error,
    created_at: new Date().toISOString(),
    providerResponseId: params.providerResponseId,
    rawRequest: params.rawRequest,
    rawResponse: params.rawResponse,
    maskedSystemPrompt: params.maskedSystemPrompt,
    maskedMessages: params.maskedMessages,
    responseTextMasked: params.responseTextMasked,
    substitutionCount: params.substitutionCount,
    toolCallsMasked: params.toolCallsMasked,
  };
}

function tryWriteLog(databaseId: string, entry: LLMLogEntry): void {
  try {
    // Logs are part of the encrypted workspace document now (not a separate table).
    writeLog(databaseId, entry);
  } catch (err) {
    console.error("[callProvider] Failed to write LLM log:", err);
  }
}
