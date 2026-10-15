import { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";

/**
 * Returns the session action buttons (Analyse Run, Back to Workflow, Start Now)
 * Called via HTMX when SSE sends workflow_complete event
 */
export const buttonsHandler = async (c: Context) => {
  const sessionId = c.req.query("session_id") || "";
  const workflowId = c.req.query("workflow_id") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId || !databaseId) {
    return c.html(<div id="session-buttons" class="flex gap-2"></div>);
  }

  const session = await getSession(databaseId, sessionId);
  if (!session) {
    return c.html(<div id="session-buttons" class="flex gap-2"></div>);
  }

  const isRunning =
    session.instance_status === "pending" ||
    session.instance_status === "in_progress";
  const isScheduled = !!session.waitingForManualStart;

  const buttonClass =
    "rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-3 py-1.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors";

  return c.html(
    <div
      id="session-buttons"
      class="flex gap-2"
      hx-get={`/sessions/api/buttons?session_id=${sessionId}&workflow_id=${workflowId}`}
      hx-trigger="sse:workflow_complete from:body"
      hx-swap="outerHTML"
    >
      <a href="javascript:history.back()" class={buttonClass}>
        Back
      </a>
      {isScheduled && (
        <button
          hx-post={`/sessions/api/resume-start/${session.session_id}`}
          hx-target="#workflow-status"
          hx-swap="outerHTML"
          class="rounded-xl px-3 py-1.5 text-sm bg-leaf-500 hover:bg-leaf-600 text-white shadow-sm font-semibold transition-colors flex items-center gap-1"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            ></path>
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          Start Now
        </button>
      )}
    </div>,
  );
};
