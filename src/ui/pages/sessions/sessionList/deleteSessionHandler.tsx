import { Context } from "hono";
import { deleteSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";
import { chatHistoryHandler } from "../chatStream/chatHistory";

/**
 * Delete a session and re-render the chat history list (targeted swap — no
 * full-page reload).
 */
export const deleteSessionHandler = async (c: Context) => {
  const sessionId = c.req.param("id");
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  try {
    await deleteSession(databaseId, sessionId);
    return chatHistoryHandler(c);
  } catch (error) {
    console.error("Error deleting session:", error);
    return c.html(
      <div class="fixed top-4 right-4 bg-coral-50 border border-coral-300 text-coral-600 dark:bg-coral-900/30 dark:border-coral-800 dark:text-coral-300 px-4 py-3 rounded-xl z-50">
        <strong class="font-bold">Error!</strong>
        <span class="block sm:inline"> Failed to delete session.</span>
      </div>,
    );
  }
};
