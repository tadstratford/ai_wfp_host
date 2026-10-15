/**
 * Chat History — builds LLM message array from session messages.
 *
 * Extracts recent user/assistant exchanges so operations like /ask
 * can maintain conversational context across turns.
 */

import { getSession } from "@backend/core/session/sessions/session_all";
import type { LLMMessage } from "@backend/core/llm/llm-client";

const MAX_HISTORY_TURNS = 10; // max user+assistant pairs to include
const MAX_HISTORY_CHARS = 8000; // rough char budget for history

/**
 * Build an LLM messages array from session history + the current user message.
 * Only includes user and assistant messages (skips system, tool, error, etc.).
 * Trims to stay within token budget.
 */
export async function buildMessagesWithHistory(
  databaseId: string,
  sessionId: string,
  currentMessage: string,
): Promise<LLMMessage[]> {
  const session = await getSession(databaseId, sessionId);
  if (!session?.messages?.length) {
    return [{ role: "user", content: currentMessage }];
  }

  // Collect recent user/assistant messages (excluding the just-added current message)
  const history: LLMMessage[] = [];
  let charCount = 0;

  // Walk backwards to get the most recent exchanges
  const msgs = session.messages;
  const candidates: { role: "user" | "assistant"; content: string }[] = [];

  for (let i = msgs.length - 1; i >= 0 && candidates.length < MAX_HISTORY_TURNS * 2; i--) {
    const m = msgs[i];
    if (m.role !== "user" && m.role !== "assistant") continue;

    const content = m.markdown || m.html?.replace(/<[^>]*>/g, "") || "";
    if (!content.trim()) continue;

    // Skip the current message (it was just added before this call)
    if (m.role === "user" && content.trim() === currentMessage.trim() && candidates.length === 0) {
      continue;
    }

    candidates.push({
      role: m.role as "user" | "assistant",
      content,
    });
  }

  // Reverse to chronological order and apply char budget
  candidates.reverse();
  for (const c of candidates) {
    if (charCount + c.content.length > MAX_HISTORY_CHARS) break;
    charCount += c.content.length;
    history.push(c);
  }

  // Ensure history starts with a user message (LLM APIs require this)
  while (history.length > 0 && history[0].role !== "user") {
    history.shift();
  }

  // Add current message
  history.push({ role: "user", content: currentMessage });

  return history;
}

/**
 * Get just the prior history (without the current message).
 * Used by the build pipeline planner which appends the user message itself.
 */
export async function getPriorHistory(
  databaseId: string,
  sessionId: string,
  currentMessage: string,
): Promise<Array<{ role: string; content: string }>> {
  const full = await buildMessagesWithHistory(databaseId, sessionId, currentMessage);
  // Remove the last message (current) that buildMessagesWithHistory appends
  if (full.length > 0) full.pop();
  return full;
}
