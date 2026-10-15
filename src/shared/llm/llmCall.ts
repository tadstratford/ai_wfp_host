/**
 * High-level LLM call helper that combines:
 * 1. Config resolution from user's database_id
 * 2. Rate limiting (for server-key users)
 * 3. The actual LLM call
 * 4. Usage logging + rate counter increment
 *
 * Use this instead of manually calling getLLMConfigByDatabaseId + callLLM + logUsage.
 */

import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { callLLM, type LLMCallOptions, type LLMCallResult } from "./llm-client";
import { logUsage } from "./usageTracker";
import { checkRateLimit, recordCall } from "./rateLimiter";
import { enforceCredit } from "./credit";
import { shouldEnforceCredit, shouldRateLimit } from "./billing";

export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitError";
    }
}

/**
 * Make a rate-limited, tracked LLM call for a user.
 *
 * @param databaseId - User's permanent database_id
 * @param source - Label for usage tracking (e.g. "chat", "pipeline:plan")
 * @param opts - LLM call options (systemPrompt, messages, etc.)
 * @returns LLMCallResult
 * @throws RateLimitError if server-key user exceeds rate limit
 */
export async function llmCall(
    databaseId: string,
    source: string,
    opts: LLMCallOptions
): Promise<LLMCallResult> {
    // 1. Resolve config
    const config = await getLLMConfigByDatabaseId(databaseId);

    if (!config.apiKey) {
        throw new Error("No API key available. Please add your own API key in Settings, or contact the administrator.");
    }

    // 2. Credit + rate limit (only for server-key users, and only when billing
    //    mode is `credits`; `admin_pays`/`none` skip the gate).
    if (config.usingServerKey && config.userId) {
        if (shouldEnforceCredit()) {
            await enforceCredit(config.userId);
        }
        if (shouldRateLimit()) {
            const limit = await checkRateLimit(config.userId);
            if (!limit.allowed) {
                throw new RateLimitError(limit.message!);
            }
        }
    }

    // 3. Make the call
    const result = await callLLM(
        { provider: config.provider, model: config.model, apiKey: config.apiKey },
        opts
    );

    // 4. Log usage + record call for rate limiting
    logUsage(databaseId, source, result.model, result.usage, {
      provider: config.provider,
      costUsd: result.costUsd,
    });
    if (config.usingServerKey && config.userId && shouldRateLimit()) {
        recordCall(config.userId);
    }

    return result;
}
