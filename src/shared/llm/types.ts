/**
 * Shared LLM types — relocated from the removed anthropic-client.ts.
 * These are plain structural types with no provider dependency.
 */

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}
