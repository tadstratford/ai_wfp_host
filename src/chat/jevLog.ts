/**
 * Shared Jev call logging — writes the audit entry and fires the log hook so a
 * Jev routing/planning call surfaces in the chat as a progress line (like
 * `skillRouter` does), rather than running silently.
 */

import { writeLog } from "@backend/core/workspace/logs";
import { fireLogHook } from "@backend/core/llm/providers";

export interface JevLogInput {
  databaseId: string;
  sessionId?: string;
  mode?: string;
  phase: string;
  questions: Record<string, unknown>;
  state: Record<string, unknown>;
  answers: Record<string, unknown>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  durationMs: number;
}

/** Best-effort: only logs when a sessionId is available. Failures are ignored so
 *  logging can never break the request it describes. */
export async function logAndFireJev(input: JevLogInput): Promise<void> {
  if (!input.sessionId) return;
  try {
    const entry = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      provider: "openrouter_jev",
      model: input.model || "jev-latest",
      mode: input.mode ?? "build",
      kind: "jev",
      durationMs: input.durationMs,
      systemPrompt: JSON.stringify(input.questions, null, 2),
      messages: [{ role: "user", content: JSON.stringify(input.state, null, 2) }],
      responseText: JSON.stringify(input.answers, null, 2),
      inputTokens: input.usage?.input_tokens,
      outputTokens: input.usage?.output_tokens,
      toolCalls: [],
      success: true,
      created_at: new Date().toISOString(),
    };
    writeLog(input.databaseId, entry as any);
    await fireLogHook({
      logId: entry.id,
      provider: "openrouter_jev",
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      phase: input.phase,
      kind: "jev",
    });
  } catch (err: any) {
    console.warn(`[jevLog] failed: ${err.message}`);
  }
}
