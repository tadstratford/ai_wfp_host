import { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";

/**
 * Export session as JSON file
 */
export const exportHandler = async (c: Context) => {
  const sessionId = c.req.param("id");
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const session = await getSession(databaseId, sessionId);

  if (!session) {
    return c.text("Session not found", 404);
  }

  const workflowId = session.activeWorkflowId;
  const filename = `session-${session.session_id.slice(0, 12)}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);

  // return c.text(JSON.stringify(session, null, 2));
  return c.json(session);
};
