import { Context } from "hono";
import {
  getSession,
  saveSession,
} from "@backend/core/session/sessions/session_all";
import { getWorkflowById, resumeAfterPause } from "@backend/core/workflow";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import type { User } from "@backend/types";

/**
 * POST /sessions/:sessionId/resume-pause
 *
 * Handles form submissions from a workflow paused via `api.pauseForInput`.
 * The submitted field/value pairs become session.parameters and the
 * executor resumes from the node AFTER the paused one.
 */
export const resumePauseHandler = async (c: Context) => {
  const sessionId = c.req.param("sessionId");
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  try {
    const body = await c.req.parseBody();
    const expectedPauseId = String(body.pauseId ?? "");

    // Extract form fields (everything except pauseId).
    const formValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === "pauseId") continue;
      formValues[k] = typeof v === "string" ? v : String(v);
    }

    const session = await getSession(databaseId, sessionId);
    if (!session) {
      return c.html(
        <div class="text-coral-600 text-sm p-2">Session not found.</div>,
      );
    }
    if (!session.waitingForInput) {
      // The pause was already resolved (most likely a duplicate submit).
      // Show a friendly idempotent placeholder rather than an error.
      return c.html(
        <div class="p-3 bg-leaf-50 dark:bg-leaf-900/30 border border-leaf-200 dark:border-leaf-800 rounded-xl text-sm text-leaf-700 dark:text-leaf-300">
          <strong>Already submitted</strong>
        </div>,
      );
    }
    const sessionPauseId = (session.metadata as any)?.pause?.pauseId;
    if (
      sessionPauseId &&
      expectedPauseId &&
      sessionPauseId !== expectedPauseId
    ) {
      return c.html(
        <div class="text-sun-600 text-sm p-2">
          Stale form — the workflow has paused at a different step since.
        </div>,
      );
    }

    const workflowId = session.activeWorkflowId;
    if (!workflowId) {
      return c.html(
        <div class="text-coral-600 text-sm p-2">
          No active workflow on this session.
        </div>,
      );
    }
    const workflow = await getWorkflowById(databaseId, workflowId);
    if (!workflow) {
      return c.html(
        <div class="text-coral-600 text-sm p-2">Workflow not found.</div>,
      );
    }

    const updated = await resumeAfterPause(
      databaseId,
      workflow,
      session,
      formValues,
    );

    await saveSession(databaseId, updated);
    notifyClients(sessionId, "new_message");

    // Replace the form with a confirmation so the chat panel reflows.
    return c.html(
      <div class="p-3 bg-leaf-50 dark:bg-leaf-900/30 border border-leaf-200 dark:border-leaf-800 rounded-xl text-sm text-leaf-700 dark:text-leaf-300">
        Submitted. Workflow continuing…
      </div>,
    );
  } catch (err: any) {
    console.error("[resumePauseHandler]", err);
    return c.html(
      <div class="text-coral-600 text-sm p-2">
        Resume failed: {String(err?.message ?? err)}
      </div>,
    );
  }
};
