import type { LLMCallOptions, LLMCallResult } from "@backend/core/models/llm-client";

export interface ParsedCommand {
  command: string;
  text: string;
}

/** Single object shape for emitting a chat message (used by chat orchestrators
 *  and the MCP app hooks — avoids the historical (markdown, html, json) arg-order
 *  confusion). */
export interface AddMessageArgs {
  markdown?: string;
  html?: string;
  json?: Record<string, any>;
  id?: string;
}

export interface SessionContext {
  databaseId: string;
  userId: string;
  sessionId: string;
  workflowId?: string;
  llmConfig: any;
  callLLM: (source: string, opts: LLMCallOptions) => Promise<LLMCallResult>;
  addMessage: (msg: { markdown: string; html?: string; json?: Record<string, any>; knowledgeUsed?: Array<{ name: string; scope: string; contentHash: string }> }) => Promise<void>;
  addError: (title: string, detail?: string) => Promise<void>;
  setBusy: () => Promise<void>;
  setDone: () => Promise<void>;
  addTodo?: (label: string, instruction: string) => Promise<void>;
  removeTodo?: (todoId: string) => Promise<void>;
  entryHint?: string;
}
