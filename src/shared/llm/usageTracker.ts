import { insert, selectOne } from "@backend/core/admin/supabase";
import type { LLMTokenUsage } from "./types";
import { shouldMeterUsage } from "./billing";
import * as fs from "fs";
import * as path from "path";

// Load cost data from providers config
let costMap: Record<string, { input: number; output: number }> = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "llm-providers.json"), "utf-8")
  );
  for (const provider of Object.values(raw.providers) as any[]) {
    for (const m of provider.models || []) {
      costMap[m.id] = { input: m.costPer1kInput, output: m.costPer1kOutput };
    }
  }
} catch {
  console.warn("[UsageTracker] Could not load llm-providers.json for cost data");
}

function calculateCost(model: string, usage: LLMTokenUsage): number {
  const rates = costMap[model];
  if (!rates) return 0;
  return (
    (usage.inputTokens / 1_000_000) * rates.input +
    (usage.outputTokens / 1_000_000) * rates.output
  );
}

// ── Buffered writes to Supabase ──────────────────────────────────────────────

interface BufferedEntry {
  id: string;
  database_id: string;
  provider: string;
  model: string;
  source: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  success: number;
  error_message: string | null;
  created_at: string;
}

const buffer: BufferedEntry[] = [];
const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

// Cache databaseId → user_id mapping
const userIdCache = new Map<string, string>();

async function resolveUserId(databaseId: string): Promise<string | null> {
  if (userIdCache.has(databaseId)) return userIdCache.get(databaseId)!;
  const { data } = await selectOne("admin_users", { database_id: databaseId }, "user_id");
  if (data?.user_id) {
    userIdCache.set(databaseId, data.user_id);
    return data.user_id;
  }
  return null;
}

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;

  const entries = buffer.splice(0);

  try {
    // Resolve user_ids for all unique database_ids
    const dbIds = [...new Set(entries.map(e => e.database_id))];
    const userIdMap = new Map<string, string | null>();
    for (const dbId of dbIds) {
      userIdMap.set(dbId, await resolveUserId(dbId));
    }

    // Map entries to Supabase rows
    const rows = entries.map(e => ({
      id: e.id,
      user_id: userIdMap.get(e.database_id) || null,
      provider: e.provider,
      model: e.model,
      source: e.source,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      cost_usd: e.cost_usd,
      success: e.success,
      error_message: e.error_message,
      created_at: e.created_at,
    }));

    const { error } = await insert("llm_usage", rows);
    if (error) {
      console.error("[UsageTracker] Failed to flush to Supabase:", error);
    }
  } catch (err) {
    console.error("[UsageTracker] Flush error:", err);
  }
}

// Start periodic flush timer
function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushBuffer().catch(err => console.error("[UsageTracker] Timer flush error:", err));
  }, FLUSH_INTERVAL_MS);
  // Don't keep process alive just for flushing
  if (flushTimer.unref) flushTimer.unref();
}

// Flush on process exit
process.on("beforeExit", () => { flushBuffer(); });

/**
 * Log an LLM call's token usage and estimated cost.
 * Entries are buffered in memory and flushed to Supabase in batches.
 */
export interface LogUsageParams {
  /** Provider id (e.g. "openrouter", "anthropic"). Defaults to "". */
  provider?: string;
  /** Authoritative per-call cost in USD (e.g. from OpenRouter). */
  costUsd?: number;
  success?: boolean;
  errorMessage?: string;
}

export function logUsage(
  databaseId: string,
  source: string,
  model: string,
  usage: LLMTokenUsage,
  params?: LogUsageParams,
): void {
  // Usage tracking is opt-out via TRACK_LLM_USAGE=false (pure self-hosted users
  // who bring their own key may not want the telemetry). Default: enabled.
  // In single-user BYO mode (BILLING_MODE=none) metering is disabled entirely.
  if (!shouldMeterUsage() || process.env.TRACK_LLM_USAGE === "false") return;
  try {
    const cost = params?.costUsd ?? calculateCost(model, usage);
    buffer.push({
      id: crypto.randomUUID(),
      database_id: databaseId,
      provider: params?.provider ?? "",
      model,
      source,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_usd: cost,
      success: params?.success === false ? 0 : 1,
      error_message: params?.errorMessage ?? null,
      created_at: new Date().toISOString(),
    });

    ensureFlushTimer();

    if (buffer.length >= FLUSH_SIZE) {
      flushBuffer().catch(err => console.error("[UsageTracker] Size flush error:", err));
    }
  } catch (err) {
    console.error("[UsageTracker] Failed to buffer usage:", err);
  }
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  callCount: number;
  bySource: Array<{
    source: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    calls: number;
  }>;
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    calls: number;
  }>;
  recentCalls: Array<{
    id: string;
    source: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    createdAt: string;
  }>;
}

/**
 * Get usage summary — queries Supabase llm_usage via RPC or REST.
 * For now, returns summary of buffered + recently flushed data.
 */
export async function getUsageSummary(
  databaseId: string,
  _since?: string,
  _until?: string
): Promise<UsageSummary> {
  // Resolve user_id
  const userId = await resolveUserId(databaseId);

  // For basic usage, query Supabase directly
  // This is a simplified version — full aggregate queries would use an RPC function
  const { data } = await import("./supabaseUsageQuery").then(m =>
    m.queryUsageSummary(userId, _since, _until)
  ).catch(() => ({ data: null }));

  if (data) return data;

  // Fallback: return empty summary
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    callCount: 0,
    bySource: [],
    byModel: [],
    recentCalls: [],
  };
}
