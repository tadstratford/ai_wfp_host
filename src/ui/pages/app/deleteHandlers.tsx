import { Context } from "hono";
import type { User } from "@backend/types";
import { deleteWorkflow } from "@backend/core/workflow";
import { deleteSession } from "@backend/core/session/sessions/session_all";
import { deleteWorkflowSessions } from "@backend/core/session/sessions/session_all";
import { deleteAllSessions } from "@backend/core/session/sessions/session_all";
import { chatPanelView } from "./chatPanel";

/**
 * DELETE /app/workflow/:workflowId — delete a workflow and refresh the view.
 */
export const deleteWorkflowHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workflowId = c.req.param("workflowId");
  if (!user.currentDatabaseId || !workflowId) return c.text("Missing context", 400);

  await deleteWorkflow(user.currentDatabaseId, workflowId);

  // Also delete associated sessions
  try {
    deleteWorkflowSessions(user.currentDatabaseId, workflowId);
  } catch {}

  // Redirect back to the app — shows workflow list
  c.header("HX-Redirect", "/app");
  return c.text("");
};

/**
 * DELETE /app/session/:sessionId — delete a single session.
 * Returns updated history list for the workflow.
 */
export const deleteSessionHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("sessionId");
  if (!user.currentDatabaseId || !sessionId) return c.text("Missing context", 400);

  await deleteSession(user.currentDatabaseId, sessionId);

  if (c.req.query("refresh") === "chat") {
    return chatPanelView(c);
  }
  return c.text("OK", 200);
};

/**
 * DELETE /app/sessions/:workflowId — delete all sessions for a workflow.
 */
export const clearSessionsHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workflowId = c.req.param("workflowId");
  if (!user.currentDatabaseId || !workflowId) return c.text("Missing context", 400);

  deleteWorkflowSessions(user.currentDatabaseId, workflowId);

  return c.html(
    <p class="text-sm text-ink-400 dark:text-ink-500">
      No runs yet. Click Run to start.
    </p>,
  );
};

/**
 * DELETE /app/sessions — clear ALL sessions in the workspace.
 * Re-renders the chat list (the "Clear all" button on /app/chat).
 */
export const clearAllSessionsHandler = async (c: Context) => {
  const user = c.get("user") as User;
  if (!user.currentDatabaseId) return c.text("Missing context", 400);

  deleteAllSessions(user.currentDatabaseId);

  return chatPanelView(c);
};
