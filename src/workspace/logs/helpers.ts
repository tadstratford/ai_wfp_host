import type { LLMLogEntry } from "wfp-format/logs";

export interface BuildLogParams {
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt: string;
  startTime: number;
  messages: Array<{ role: string; content: string }>;
}

export function buildErrorLogEntry(
  params: BuildLogParams,
  error: Error,
): LLMLogEntry {
  return {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    mode: "",
    durationMs: Date.now() - params.startTime,
    systemPrompt: params.systemPrompt,
    messages: params.messages,
    responseText: "",
    inputTokens: undefined,
    outputTokens: undefined,
    toolCalls: [],
    success: false,
    error: error.message || String(error),
    created_at: new Date().toISOString(),
  };
}

export interface BuildStepLogParams extends BuildLogParams {
  stepText: string;
  toolCalls: Array<{ toolName: string; args: any }>;
  inputTokens?: number;
  outputTokens?: number;
  stepMessages?: Array<{ role: string; content: string }>;
}

export function buildStepLogEntry(params: BuildStepLogParams): LLMLogEntry {
  return {
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    provider: params.provider,
    model: params.model,
    mode: "",
    durationMs: Date.now() - params.startTime,
    systemPrompt: params.systemPrompt,
    messages: (params.stepMessages && params.stepMessages.length > 0)
      ? params.stepMessages
      : params.messages,
    responseText: params.stepText,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    toolCalls: params.toolCalls.map((tc) => ({
      name: tc.toolName,
      args: tc.args ?? {},
    })),
    success: true,
    created_at: new Date().toISOString(),
  };
}
