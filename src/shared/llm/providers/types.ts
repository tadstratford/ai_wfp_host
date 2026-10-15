/**
 * Provider Types — normalized interfaces for the LLM provider layer.
 *
 * Every provider adapter (anthropic.ts, deepseek.ts) takes a ProviderRequest
 * and returns a ProviderResponse. The dispatcher (index.ts) resolves config
 * internally and routes to the correct adapter.
 */

// ── Messages ─────────────────────────────────────────────────────────────────

export interface ProviderMessage {
  role: "user" | "assistant";
  content: string | ProviderContentBlock[];
}

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

// ── Tool schemas ─────────────────────────────────────────────────────────────

export interface ProviderToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── Request / Response ───────────────────────────────────────────────────────

export type ProviderToolChoice = "auto" | "required" | { name: string };

export interface ProviderRequest {
  system: string;
  messages: ProviderMessage[];
  tools?: ProviderToolSchema[];
  /** Constrain which tool the model may call. `{ name }` forces a specific tool. */
  toolChoice?: ProviderToolChoice;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
}

export interface ProviderResponse {
  text: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  /** Authoritative cost of this call in USD (returned by OpenRouter). */
  costUsd?: number;
}

// ── Config resolved from admin_users ─────────────────────────────────────────

export interface ResolvedConfig {
  provider: string;
  model: string;
  apiKey: string;
  /** Owning user's id (for credit/rate-limit guards). */
  userId?: string;
  /** True when the operator's server-side key is being used. */
  usingServerKey?: boolean;
}
