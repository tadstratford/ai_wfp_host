import { settings } from "@backend/core/settings/settings";
import { addMessage } from "@backend/core/session";
import { v4 as uuidv4 } from "uuid";
import type {
  ChatMessage,
  LLMOptions,
  LLMResult,
  LLMResultWithUsage,
  LLMUsageData,
  LLMConfig,
  Session,
} from "@backend/types";

/**
 * Clean LLM interface for Together AI
 * Accepts standard OpenAI-compatible messages and options
 */
export async function runLLM(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResult> {
  const result = await runLLMWithUsage(messages, options);
  return {
    success: result.success,
    content: result.content,
    error: result.error,
  };
}

/**
 * LLM call with detailed usage tracking and automatic JSON parsing
 */
export async function runLLMWithUsage(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResultWithUsage> {
  const config = settings.getLLMConfig();

  // Try to get user-specific key first, then fallback to global env
  let userId = options.userId;
  if (!userId && options.session?.metadata?.userId) {
    userId = options.session.metadata.userId as string;
  }

  let apiKey = userId ? settings.getLLMApiKey(userId) : undefined;

  if (!apiKey) {
    apiKey = process.env[config.apiKeyEnv];
  }

  if (!apiKey) {
    return {
      success: false,
      error: `${config.apiKeyEnv} is not set in environment variables and no user key provided.`,
    };
  }

  const startTime = Date.now();
  const requestId = uuidv4();
  const promptName = options.promptName || "api_call";
  const returnType = options.returnType || "json"; // Default to JSON
  const apiUrl = "https://api.together.xyz/v1/chat/completions";

  // Log prompt to audit trail if session provided
  if (options.session) {
    await logPromptToAudit(options.session, messages, promptName, requestId);
  }

  // Build payload with options
  const payload: any = {
    model: config.model,
    messages: messages,
    max_tokens: options.maxTokens || config.maxTokens || 4000,
    temperature: options.temperature ?? config.temperature ?? 0.7,
  };

  // Add JSON mode if requested or if returnType is json
  if (options.jsonMode || returnType === "json") {
    payload.response_format = { type: "json_object" };
  }

  try {
    console.log(
      `💬 Sending ${messages.length} messages to Together AI model: ${config.model} (${promptName})`
    );

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `❌ Together AI API Error (${response.status}): ${errorBody}`
      );

      const usage: LLMUsageData = {
        prompt_name: promptName,
        model_name: config.model,
        provider: "together",
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        request_duration_ms: duration,
        success: false,
        error_message: `API request failed with status ${response.status}: ${errorBody}`,
      };

      // Log error response to audit trail
      if (options.session) {
        await logResponseToAudit(
          options.session,
          null,
          usage,
          requestId,
          `API Error: ${errorBody}`
        );
      }

      return {
        success: false,
        error: `API request failed with status ${response.status}: ${errorBody}`,
        usage,
        raw_response: { error: errorBody, status: response.status },
      };
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error("❌ No reply content found in Together AI response:", data);

      const usage: LLMUsageData = {
        prompt_name: promptName,
        model_name: config.model,
        provider: "together",
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
        request_duration_ms: duration,
        success: false,
        error_message: "No reply content found in API response",
      };

      // Log empty response to audit trail
      if (options.session) {
        await logResponseToAudit(
          options.session,
          null,
          usage,
          requestId,
          "No reply content found"
        );
      }

      return {
        success: false,
        error: "No reply content found in API response.",
        usage,
        raw_response: data,
      };
    }

    console.log("✅ Received reply from Together AI.");

    // Calculate cost (Together AI pricing)
    const inputCostPer1M = 0.27;
    const outputCostPer1M = 1.1;
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const cost =
      (promptTokens / 1_000_000) * inputCostPer1M +
      (completionTokens / 1_000_000) * outputCostPer1M;

    const usage: LLMUsageData = {
      prompt_name: promptName,
      model_name: config.model,
      provider: "together",
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: data.usage?.total_tokens || 0,
      request_duration_ms: duration,
      api_cost_usd: cost,
      success: true,
    };

    console.log(
      `📊 Usage: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens (${duration}ms)`
    );

    // Parse JSON if returnType is json
    let processedContent = reply;
    if (returnType === "json") {
      try {
        // Remove markdown code blocks if present
        let jsonContent = reply;
        if (jsonContent.includes("```json")) {
          jsonContent = jsonContent
            .replace(/```json\s*\n?/g, "")
            .replace(/```\s*$/g, "")
            .trim();
        } else if (jsonContent.includes("```")) {
          jsonContent = jsonContent
            .replace(/```\s*\n?/g, "")
            .replace(/```\s*$/g, "")
            .trim();
        }

        // Parse JSON
        processedContent = JSON.parse(jsonContent);
      } catch (parseError) {
        console.error("Failed to parse JSON response:", parseError);
        // Log parse error to audit trail
        if (options.session) {
          await logResponseToAudit(
            options.session,
            reply,
            usage,
            requestId,
            `JSON parse error: ${parseError instanceof Error ? parseError.message : "Unknown error"
            }`
          );
        }
        return {
          success: false,
          error: `Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : "Unknown error"
            }`,
          usage,
          raw_response: data,
        };
      }
    }

    // Log successful response to audit trail
    if (options.session) {
      await logResponseToAudit(options.session, reply, usage, requestId);
    }

    return {
      success: true,
      content: processedContent,
      usage,
      raw_response: data,
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown LLM error";

    console.error("❌ Error calling Together AI API:", error);

    const usage: LLMUsageData = {
      prompt_name: promptName,
      model_name: config.model,
      provider: "together",
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      request_duration_ms: duration,
      success: false,
      error_message: errorMessage,
    };

    // Log exception to audit trail
    if (options.session) {
      await logResponseToAudit(
        options.session,
        null,
        usage,
        requestId,
        `Exception: ${errorMessage}`
      );
    }

    return {
      success: false,
      error: `Failed to get LLM reply: ${errorMessage}`,
      usage,
      raw_response: { error: errorMessage },
    };
  }
}

export function getModelName(): string {
  const config = settings.getLLMConfig();
  return config.model;
}

/**
 * Convenience function for JSON responses
 */
export async function runLLMForJSON<T = any>(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<T> {
  const result = await runLLM(messages, { ...options, returnType: "json" });
  if (!result.success) {
    throw new Error(result.error || "LLM request failed");
  }
  return result.content as T;
}

/**
 * Log LLM prompt to audit trail with structured format
 */
async function logPromptToAudit(
  session: Session,
  messages: ChatMessage[],
  promptName: string,
  requestId: string
): Promise<void> {
  try {
    const config = settings.getLLMConfig();
    const promptContent = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    // Store ONLY the prompt content in markdown field
    // Metadata goes in JSON and HTML fields
    const htmlContent = `[LLM_PROMPT] **LLM Prompt Audit**

**Request ID:** ${requestId}
**Prompt Name:** ${promptName}
**Model:** ${config.model}
**Timestamp:** ${new Date().toISOString()}
**Messages:** ${messages.length}

**Prompt Content:**
\`\`\`
${promptContent}
\`\`\``;

    await addMessage({
      session,
      role: "system",
      html: htmlContent,
      markdown: promptContent, // ONLY the prompt content, no metadata
      source: promptName,
      data: [],
      json: {
        audit_type: "llm_prompt",
        request_id: requestId,
        prompt_name: promptName,
        model: config.model,
        message_count: messages.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to log prompt to audit trail:", error);
  }
}

/**
 * Log LLM response to audit trail with structured format
 */
async function logResponseToAudit(
  session: Session,
  response: string | null,
  usage: LLMUsageData,
  requestId: string,
  errorDetails?: string
): Promise<void> {
  try {
    // Store ONLY the response content in markdown field
    // Metadata goes in JSON and HTML fields
    const htmlContent = `[LLM_RESPONSE] **LLM Response Audit**

**Request ID:** ${requestId}
**Status:** ${usage.success ? "[SUCCESS]" : "[ERROR]"} ${usage.success ? "Success" : "Failed"
      }
**Model:** ${usage.model_name}
**Duration:** ${usage.request_duration_ms}ms
**Tokens:** ${usage.prompt_tokens} + ${usage.completion_tokens} = ${usage.total_tokens
      }
**Cost:** $${usage.api_cost_usd?.toFixed(6) || "0.000000"}
**Timestamp:** ${new Date().toISOString()}

${errorDetails ? `**Error:** ${errorDetails}` : ""}

**Response Content:**
\`\`\`
${response || "No response content"}
\`\`\``;

    await addMessage({
      session,
      role: "system",
      html: htmlContent,
      markdown: response || "", // ONLY the response content, no metadata
      source: `${usage.prompt_name}_response`,
      data: [],
      json: {
        audit_type: "llm_response",
        request_id: requestId,
        success: usage.success,
        usage: usage,
        error_details: errorDetails,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to log response to audit trail:", error);
  }
}
