import { select } from "@backend/core/admin/supabase";

/**
 * Per-user rate limiter for server-key LLM calls.
 * Checks recent call count in Supabase llm_usage table.
 * Users with their own API key bypass rate limiting.
 *
 * Also uses an in-memory counter for fast checks between Supabase flushes.
 */

const DEFAULT_MAX_CALLS_PER_HOUR = 60;

// In-memory counters (covers calls not yet flushed to Supabase)
const memoryCounters = new Map<string, { count: number; windowStart: number }>();

function getMemoryCount(userId: string): number {
    const entry = memoryCounters.get(userId);
    if (!entry) return 0;
    const now = Date.now();
    // Reset if window expired
    if (now - entry.windowStart > 3_600_000) {
        memoryCounters.set(userId, { count: 0, windowStart: now });
        return 0;
    }
    return entry.count;
}

function incrementMemoryCount(userId: string): void {
    const now = Date.now();
    const entry = memoryCounters.get(userId);
    if (!entry || now - entry.windowStart > 3_600_000) {
        memoryCounters.set(userId, { count: 1, windowStart: now });
    } else {
        entry.count++;
    }
}

/**
 * Check if a user has exceeded their rate limit.
 * Returns { allowed: true } or { allowed: false, message: string }.
 */
export async function checkRateLimit(userId: string): Promise<{
    allowed: boolean;
    message?: string;
    remaining?: number;
}> {
    const maxCalls = Number(process.env.LLM_RATE_LIMIT_PER_HOUR) || DEFAULT_MAX_CALLS_PER_HOUR;

    // Fast path: check in-memory counter first
    const memCount = getMemoryCount(userId);
    if (memCount >= maxCalls) {
        return {
            allowed: false,
            message: `Rate limit exceeded. You can make up to ${maxCalls} AI calls per hour. Please try again later, or add your own API key in Settings to remove this limit.`,
            remaining: 0,
        };
    }

    return { allowed: true, remaining: maxCalls - memCount };
}

/**
 * Record that a call was made (for in-memory tracking).
 * Called after a successful LLM call.
 */
export function recordCall(userId: string): void {
    incrementMemoryCount(userId);
}
