import { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";

/**
 * Render a session message's HTML in a standalone page (new browser tab).
 * URL: /sessions/report?session_id=<uuid>&id=<message_id>
 */
export const reportHandler = async (c: Context) => {
  const sessionId = c.req.query("session_id") || "";
  const messageId = c.req.query("id") || "";

  if (!sessionId || !messageId) {
    return c.text("Missing session_id or id query parameter", 400);
  }

  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const session = await getSession(databaseId, sessionId);

  if (!session) {
    return c.text("Session not found", 404);
  }

  // Search by message id first, then fall back to json.messageId for messages
  // persisted before the id was threaded through addMessage.
  const message = session.messages.find(
    (m: any) => m.id === messageId || m.json?.messageId === messageId,
  );
  if (!message) {
    return c.text("Message not found", 404);
  }

  const htmlContent = (message as any).json?.reportHtml || "";
  if (!htmlContent) {
    return c.text("This message has no HTML content", 404);
  }

  return c.html(htmlContent);
};
