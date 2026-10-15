/**
 * OpenAI-compatible Provider — raw fetch to an OpenAI-style /chat/completions
 * endpoint. Used by DeepSeek directly, and as the base for OpenRouter.
 *
 * Uses OpenAI-compatible format with tools[] + tool_choice.
 * Retry on 429/503/529 with exponential backoff.
 */

import type {
  ProviderRequest,
  ProviderResponse,
  ProviderMessage,
  ProviderToolSchema,
  ProviderToolChoice,
} from "./types";

const RETRYABLE = new Set([429, 503, 529]);
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;

/** Convert our normalized messages to OpenAI-compatible format. */
export function toOpenAIMessages(
  system: string,
  messages: ProviderMessage[],
): any[] {
  const out: any[] = [];
  if (system) {
    out.push({ role: "system", content: system });
  }
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
    } else {
      // Convert Anthropic-style content blocks to OpenAI format. Merge any text
      // and tool_use blocks into ONE assistant message (OpenAI requires the
      // assistant message that carries `tool_calls` to also carry a `content`
      // field — null when there is no accompanying text). tool_result blocks
      // become their own `tool` role messages.
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      for (const block of m.content) {
        if (block.type === "text") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        } else if (block.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
      if (textParts.length > 0 || toolCalls.length > 0) {
        out.push({
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("") : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
    }
  }
  return out;
}

/** Convert our tool schemas to OpenAI-compatible format. */
export function toOpenAITools(tools: ProviderToolSchema[]): any[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Map our normalized tool choice to OpenAI's `tool_choice` value. */
function toOpenAIToolChoice(choice?: ProviderToolChoice): any {
  if (!choice) return "auto";
  if (choice === "required") return "required";
  if (choice === "auto") return "auto";
  return { type: "function", function: { name: choice.name } };
}

export interface OpenAICompatibleOptions {
  /** Full endpoint URL, e.g. https://api.deepseek.com/v1/chat/completions */
  baseUrl: string;
  /** Extra request headers (merged with content-type + Authorization). */
  extraHeaders?: Record<string, string>;
  /** Extra top-level body fields (merged into the request body). */
  extraBody?: Record<string, unknown>;
  /** OpenRouter-style `provider` routing object (data_collection, zdr, …). */
  providerRouting?: Record<string, unknown>;
  /** When true, parse the authoritative per-call cost from the response. */
  parseCost?: boolean;
}

export interface OpenAICompatibleCallResult extends ProviderResponse {
  providerResponseId?: string;
  rawRequest?: string;
  rawResponse?: string;
}

export async function callOpenAICompatible(
  apiKey: string,
  model: string,
  request: ProviderRequest,
  opts: OpenAICompatibleOptions,
): Promise<OpenAICompatibleCallResult> {
  const body: Record<string, any> = {
    model,
    messages: toOpenAIMessages(request.system, request.messages),
    max_tokens: request.maxTokens ?? 4096,
  };

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = toOpenAITools(request.tools);
    body.tool_choice = toOpenAIToolChoice(request.toolChoice);
  }

  if (opts.providerRouting && Object.keys(opts.providerRouting).length > 0) {
    body.provider = opts.providerRouting;
  }

  if (opts.extraBody) {
    Object.assign(body, opts.extraBody);
  }

  const rawRequest = JSON.stringify(body);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(opts.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(opts.extraHeaders ?? {}),
        },
        body: rawRequest,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`LLM API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const data = (await response.json()) as any;
      return {
        ...parseOpenAIResponse(data, opts.parseCost),
        providerResponseId: data.id,
        rawRequest,
        rawResponse: JSON.stringify(data),
      };
    }

    const errorText = await response.text();

    if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `[openai-compatible] ${response.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      lastError = new Error(`LLM API ${response.status}: ${errorText}`);
      continue;
    }

    throw new Error(`LLM API error (${response.status} ${model}): ${errorText}`);
  }

  throw lastError || new Error("LLM call failed after retries");
}

export interface DeepSeekCallResult extends OpenAICompatibleCallResult {}

export async function callDeepSeek(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<DeepSeekCallResult> {
  return callOpenAICompatible(apiKey, model, request, {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
  });
}

function parseOpenAIResponse(
  data: any,
  parseCost = false,
): ProviderResponse {
  const choice = data.choices?.[0];
  const message = choice?.message;
  const text = message?.content ?? "";

  let toolCall: ProviderResponse["toolCall"] = undefined;
  const toolCalls = message?.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const tc = toolCalls[0]; // sequential: one tool per response
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      args = {};
    }
    toolCall = {
      id: tc.id,
      name: tc.function?.name ?? "",
      args,
    };
  }

  const finishReason = choice?.finish_reason;
  const stopReason: ProviderResponse["stopReason"] =
    finishReason === "tool_calls"
      ? "tool_use"
      : finishReason === "length"
        ? "max_tokens"
        : "end_turn";

  const costUsd = parseCost
    ? parseCostUsd(data)
    : undefined;

  return {
    text,
    toolCall,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    stopReason,
    costUsd,
  };
}

/** OpenRouter returns the authoritative cost in a few possible fields. */
function parseCostUsd(data: any): number | undefined {
  const candidates = [
    data.usage?.cost,
    data.usage?.total_cost,
    data.total_cost,
    data.cost,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return undefined;
}
