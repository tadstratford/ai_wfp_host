/**
 * THE LOOP — reason → act → repeat.
 *
 * An explicit while-loop that calls the LLM provider, checks for tool calls,
 * executes them, and feeds results back. No framework, no hidden control flow.
 *
 * Two guardrails end every turn:
 *   1. The model stops asking for tools → natural end
 *   2. maxIterations reached → hard stop, never spin forever
 */

import { callProvider } from "@backend/core/llm/providers";
import type {
  ProviderMessage,
  ProviderToolSchema,
  ProviderContentBlock,
} from "@backend/core/llm/providers";

export interface LoopResult {
  reply: string;
  toolCalls: { tool: string; args: Record<string, unknown>; output: string; durationMs: number }[];
  iterations: number;
  logIds: string[];
  /** Full in-memory transcript (user/assistant turns incl. tool_use/tool_result) so the turn can be resumed. */
  messages: ProviderMessage[];
  /** True when the loop was cut off by maxIterations (guardrail 2), false on a natural end. */
  hitCap: boolean;
}

/** How many times to nudge the model for a final answer when it stops empty after tool work. */
const MAX_EMPTY_NUDGES = 1;

export interface LoopOptions {
  databaseId: string;
  sessionId: string;
  userId?: string;
  mode?: string;
  system: string;
  messages: ProviderMessage[];
  toolSchemas: ProviderToolSchema[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  onLLMCall?: (logId: string, iteration: number, text?: string) => Promise<void>;
  onToolCall?: (name: string, iteration: number) => Promise<void>;
  maxIterations?: number;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const maxIter = opts.maxIterations ?? 10;

  const result: LoopResult = {
    reply: "",
    toolCalls: [],
    iterations: 0,
    logIds: [],
    messages: [],
    hitCap: false,
  };

  // Working copy of messages — mutated in place as the loop progresses
  const messages: ProviderMessage[] = [...opts.messages];

  let nudges = 0;

  for (let iteration = 1; iteration <= maxIter; iteration++) {
    result.iterations = iteration;

    // ── reason: one LLM call ──────────────────────────────────────────
    let response;
    try {
      response = await callProvider(
        opts.databaseId,
        {
          system: opts.system,
          messages,
          tools: opts.toolSchemas.length > 0 ? opts.toolSchemas : undefined,
          maxTokens: 8192,
          temperature: 0.2,
        },
        {
          sessionId: opts.sessionId,
          userId: opts.userId,
          mode: opts.mode,
          phase: "reasoning",
          iteration,
        },
      );
    } catch (err: any) {
      throw err;
    }

    // Collect logId if the provider wrote one
    if (response.logId) {
      result.logIds.push(response.logId);
      if (opts.onLLMCall) {
        await opts.onLLMCall(response.logId, iteration, response.text || undefined);
      }
    }

    // ── guardrail 1: no tool call → the model is done ─────────────────
    if (!response.toolCall) {
      // Truncation: the provider cut the response off at max_tokens before the
      // model finished (empty text + no tool call). This is NOT a clean end —
      // signal the orchestrator to auto-continue from the transcript instead of
      // surfacing an empty/misleading reply. Partial text is intentionally not
      // pushed so the resume transcript still ends on the last tool_result.
      if (response.stopReason === "max_tokens") {
        result.hitCap = true;
        result.reply =
          'I was cut off by the output limit before finishing. Say "continue" and I\'ll pick up where I left off.';
        result.messages = messages;
        return result;
      }

      // Empty end after tool work: the model stopped without a final answer.
      // Nudge it once to deliver the result, then continue the loop so any
      // follow-up tool call (e.g. chat_download) still executes normally.
      if (
        !(response.text || "").trim() &&
        result.toolCalls.length > 0 &&
        nudges < MAX_EMPTY_NUDGES
      ) {
        nudges++;
        messages.push({
          role: "user",
          content:
            "You completed the tool calls but returned no final answer. " +
            "Now deliver the final result (or the requested report/document) to the user.",
        });
        continue;
      }

      result.reply = response.text;
      if (response.text) {
        messages.push({ role: "assistant", content: response.text });
      }
      result.messages = messages;
      return result;
    }

    // ── act: execute the tool; feed result back ───────────────────────
    const assistantContent: ProviderContentBlock[] = [];
    if (response.text) {
      assistantContent.push({ type: "text", text: response.text });
    }
    assistantContent.push({
      type: "tool_use",
      id: response.toolCall.id,
      name: response.toolCall.name,
      input: response.toolCall.args,
    });
    messages.push({ role: "assistant", content: assistantContent });

    // Execute the tool
    const toolStart = Date.now();
    let toolOutput: string;
    try {
      toolOutput = await opts.executeTool(
        response.toolCall.name,
        response.toolCall.args,
      );
    } catch (err: any) {
      toolOutput = `Error: ${err.message}`;
    }

    result.toolCalls.push({
      tool: response.toolCall.name,
      args: response.toolCall.args,
      output: toolOutput.slice(0, 500),
      durationMs: Date.now() - toolStart,
    });

    if (opts.onToolCall) {
      await opts.onToolCall(response.toolCall.name, iteration);
    }

    // Feed the tool result back into working memory
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: response.toolCall.id,
          content: toolOutput,
        },
      ],
    });
  }

  // ── guardrail 2: ran out of iterations ────────────────────────────────
  const calledTools = result.toolCalls.map((tc) => `\`${tc.tool}\``).join(", ");
  result.hitCap = true;
  result.reply =
    `I hit my step limit (${maxIter} tool calls). So far I've: ${calledTools}. ` +
    "I can keep going — just say \"continue\" or tell me which part to focus on.";
  messages.push({ role: "assistant", content: result.reply });
  result.messages = messages;

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert MCP tool definitions to ProviderToolSchema format.
 */
export function mcpToolsToProvider(mcpTools: any[]): ProviderToolSchema[] {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.inputSchema || { type: "object", properties: {} },
  }));
}
