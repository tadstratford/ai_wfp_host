import { Context } from "hono";
import {
  getSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import {
  getWorkflowById,
  resumeScheduledWorkflow,
} from "@backend/core/workflow";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import type { User } from "@backend/types";

/**
 * Resume a scheduled workflow manually
 */
export const resumeStartHandler = async (c: Context) => {
  const sessionId = c.req.param("sessionId");
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  try {
    const session = await getSession(databaseId, sessionId);
    if (!session) {
      return c.html(<div class="text-coral-600">Session not found</div>);
    }

    if (!session.waitingForManualStart) {
      return c.html(
        <div class="text-sun-600">
          Session is not waiting for manual start
        </div>,
      );
    }

    const workflowId = session.activeWorkflowId;
    if (!workflowId) {
      return c.html(<div class="text-coral-600">No workflow associated</div>);
    }

    const workflow = await getWorkflowById(databaseId, workflowId);
    if (!workflow) {
      return c.html(<div class="text-coral-600">Workflow not found</div>);
    }

    // Resume the workflow
    const updatedSession = await resumeScheduledWorkflow(
      databaseId,
      workflow,
      session,
    );

    // Persist updated session
    await updateSession(
      databaseId,
      sessionId,
      "waiting_for_manual_start",
      updatedSession.waitingForManualStart ? 1 : 0,
    );
    await updateSession(
      databaseId,
      sessionId,
      "messages",
      updatedSession.messages,
    );

    // Notify SSE clients
    notifyClients(sessionId, "new_message");

    return c.html(<span class="text-leaf-600">Started</span>);
  } catch (error) {
    return c.html(<div class="text-coral-600">Error: {String(error)}</div>);
  }
};
