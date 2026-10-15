export interface LLMLogEntry {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  mode: string;
  /** Distinguishes a structured Jev routing call from a chat LLM call. */
  kind?: "llm" | "jev";
  durationMs: number;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  responseText: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  /** Obfuscated (privacy-masked) tool calls, captured before unmasking. */
  toolCallsMasked?: Array<{ name: string; args: unknown }>;
  success: boolean;
  error?: string;
  created_at: string;
  providerResponseId?: string;
  rawRequest?: string;
  rawResponse?: string;
  /** Obfuscated (privacy-masked) copies of the outgoing request. */
  maskedSystemPrompt?: string;
  maskedMessages?: Array<{ role: string; content: string }>;
  /** Obfuscated model output before privacy unmasking. */
  responseTextMasked?: string;
  /** Number of privacy substitutions applied to this call. */
  substitutionCount?: number;
}
