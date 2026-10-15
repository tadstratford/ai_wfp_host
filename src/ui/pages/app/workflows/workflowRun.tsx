import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkflowById, executeWorkflow } from "@backend/core/workflow";
import { createSession, updateSession, gcTransientSessions } from "@backend/core/session/sessions/session_all";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { renderChatContent } from "@frontend/pages/sessions/chatStream";
import { renderShell, pushUrl } from "../workspace/shellPage";

/**
 * Workflow run panel — runs a workflow EPHEMERALLY into `#main-panel`.
 *
 * This is how a workflow tagged with a `group` is opened from the left nav: the
 * workflow runs into a **transient** session (excluded from every session list
 * and GC'd after a TTL — see session_all.ts), and its messages stream into the
 * panel. "Ephemeral" only means the session isn't listed; artifacts still
 * persist normally (`api.setData` writes to the .wfp; report downloads emit), so
 * a page can still read or adjust workspace state.
 */
export const workflowRunPanel = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const workflowId = c.req.param("workflowId");

  const workflow = await getWorkflowById(databaseId, workflowId);
  if (!workflow) {
    return c.html(
      <div class="p-6 rounded-xl bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800">
        <h2 class="font-semibold text-coral-600 dark:text-coral-300">Workflow not found</h2>
      </div>,
    );
  }

  // Clean up prior ephemeral runs so transient sessions don't accumulate.
  try { gcTransientSessions(databaseId); } catch (err) { console.error("[workflowRun] gc failed:", err); }

  // Create the transient session that backs this page view.
  const session = await createSession(databaseId, user.userId, workflow.name);
  session.activeWorkflowId = workflowId;
  session.metadata = { ...(session.metadata ?? {}), transient: true, userId: user.userId };
  await updateSession(databaseId, session.session_id, "workflow_id", workflowId);
  await updateSession(databaseId, session.session_id, "metadata", session.metadata);

  const sessionId = session.session_id;

  // Run in the background; the panel streams messages over SSE as they arrive.
  executeWorkflow(databaseId, workflowId, sessionId, "", session)
    .then(() => notifyClients(sessionId, "workflow_complete"))
    .catch((err) => console.error("[workflowRun] execution error:", err));

  const content = await renderChatContent(user, session, workflowId, workflow.name, true, "", "", true);

  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Push-Url", pushUrl(c));
    return c.html(<>{content}</>);
  }

  return c.html(renderShell(user, databaseId, workflowId, `/app/run/${workflowId}`));
};
