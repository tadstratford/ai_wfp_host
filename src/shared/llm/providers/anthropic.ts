/**
 * Anthropic Provider — raw fetch to api.anthropic.com/v1/messages.
 *
 * Handles tool_use content blocks for the explicit loop.
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

/** Convert our normalized messages to Anthropic format. */
function toAnthropicMessages(messages: ProviderMessage[]): any[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    // Array content blocks — pass through for tool_use / tool_result
    return { role: m.role, content: m.content };
  });
}

/** Convert our tool schemas to Anthropic format. */
function toAnthropicTools(tools: ProviderToolSchema[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Map our normalized tool choice to Anthropic's `tool_choice` value. */
function toAnthropicToolChoice(choice?: ProviderToolChoice): any {
  if (!choice || choice === "auto") return undefined;
  if (choice === "required") return { type: "any" };
  return { type: "tool", name: choice.name };
}

export interface AnthropicCallResult extends ProviderResponse {
  providerResponseId?: string;
  rawRequest?: string;
  rawResponse?: string;
}

export async function callAnthropic(
  apiKey: string,
  model: string,
  request: ProviderRequest,
): Promise<AnthropicCallResult> {
  const body: Record<string, any> = {
    model,
    max_tokens: request.maxTokens ?? 4096,
    system: request.system,
    messages: toAnthropicMessages(request.messages),
  };

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = toAnthropicTools(request.tools);
    const tc = toAnthropicToolChoice(request.toolChoice);
    if (tc) body.tool_choice = tc;
  }

  // For JSON responses, prefill the assistant message with "{" to force JSON output
  if (request.responseFormat === "json") {
    const msgs = body.messages || [];
    msgs.push({ role: "assistant", content: "{" });
    body.messages = msgs;
  }

  const rawRequest = JSON.stringify(body);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: rawRequest,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Anthropic API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const data = await response.json() as any;
      const parsed = parseAnthropicResponse(data);
      if (request.responseFormat === "json") {
        parsed.text = "{" + parsed.text;
      }
      return {
        ...parsed,
        providerResponseId: data.id,
        rawRequest,
        rawResponse: JSON.stringify(data),
      };
    }

    const errorText = await response.text();

    if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `[anthropic] ${response.status} — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, delay));
      lastError = new Error(`Anthropic API ${response.status}: ${errorText}`);
      continue;
    }

    throw new Error(
      `Anthropic API error (${response.status} ${model}): ${errorText}`,
    );
  }

  throw lastError || new Error("Anthropic call failed after retries");
}

function parseAnthropicResponse(data: any): ProviderResponse {
  let text = "";
  let toolCall: ProviderResponse["toolCall"] = undefined;

  for (const block of data.content || []) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCall = {
        id: block.id,
        name: block.name,
        args: block.input ?? {},
      };
    }
  }

  const stopReason: ProviderResponse["stopReason"] =
    data.stop_reason === "tool_use"
      ? "tool_use"
      : data.stop_reason === "max_tokens"
        ? "max_tokens"
        : "end_turn";

  return {
    text,
    toolCall,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
    stopReason,
  };
}
