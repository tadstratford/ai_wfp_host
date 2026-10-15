import { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";

/**
 * Get status badge for a session
 * Called via HTMX when SSE sends workflow_complete event
 */
export const statusHandler = async (c: Context) => {
  const sessionId = c.req.query("session_id") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId) {
    return c.html(
      <span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70">
        Unknown
      </span>,
    );
  }

  const session = await getSession(databaseId, sessionId);
  if (!session) {
    return c.html(
      <span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70">
        Not Found
      </span>,
    );
  }

  // Determine status from session state
  const status = session.instance_status || "";
  const hasErrors = session.messages?.some((m: any) => m.role === "error") || false;
  let statusText = "";
  let statusClass = "bg-ink/[0.05] dark:bg-white/[0.06] text-ink-600 dark:text-white/70";

  if (status === "in_progress" || status === "pending") {
    statusText = "Running";
    statusClass = "bg-leaf-50 dark:bg-leaf-900/40 text-leaf-700 dark:text-leaf-300";
  } else if (status === "awaiting_feedback" && hasErrors) {
    statusText = "Error";
    statusClass = "bg-coral-50 dark:bg-coral-900/40 text-coral-600 dark:text-coral-300";
  } else if (status === "awaiting_feedback") {
    statusText = "Done — Review";
    statusClass = "bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300";
  } else if (status === "cancelled") {
    statusText = "Cancelled";
    statusClass = "bg-ink/[0.05] dark:bg-white/[0.06] text-ink-500 dark:text-white/60";
  } else if (status === "not_satisfied") {
    statusText = "Needs Work";
    statusClass = "bg-sun-50 dark:bg-sun-900/40 text-sun-600 dark:text-sun-300";
  } else if (status === "satisfied" || status === "completed") {
    statusText = "Done";
  } else if (session.waitingForInput) {
    statusText = "Needs Input";
    statusClass = "bg-sun-50 dark:bg-sun-900/40 text-sun-600 dark:text-sun-300";
  } else if (session.waitingForManualStart) {
    statusText = "Ready to Run";
    statusClass = "bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300";
  }

  // No badge if no status set yet
  if (!statusText) {
    return c.html(
      <span
        id="workflow-status"
        class="hidden"
        hx-get={`/sessions/api/status?session_id=${session.session_id}`}
        hx-trigger="sse:workflow_complete from:body, sse:new_message from:body"
        hx-swap="outerHTML"
      ></span>,
    );
  }

  return c.html(
    <span
      id="workflow-status"
      class={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}
      hx-get={`/sessions/api/status?session_id=${session.session_id}`}
      hx-trigger="sse:workflow_complete from:body, sse:new_message from:body"
      hx-swap="outerHTML"
    >
      {statusText}
    </span>,
  );
};
