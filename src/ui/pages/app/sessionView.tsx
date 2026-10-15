import { Context } from "hono";
import type { User } from "@backend/types";
import { createSession } from "@backend/core/session/sessions/session_all";
import { setCurrentWorkflowId } from "@backend/core/user";
import { refreshActiveWorkspaceIfStale } from "@backend/core/workspace/workspaceLifecycle";
import { activeShellId, shellChatUrl, shellChatListUrl } from "./shellUrls";

/**
 * GET /app/session — Load a session into #main-panel (within the app layout).
 *
 * Replaces navigation to /sessions (separate HTML shell).
 * Renders a loading spinner that triggers the appropriate /sessions/* partial via HTMX.
 *
 * Query params:
 *   session_id — view an existing session
 *   workflow_id + action=run — start a workflow run
 *   action=new — create a new session (optionally with prefill/todo_id)
 *   action=todo — auto-submit a todo instruction
 */
export const sessionViewHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!databaseId) {
    return c.html(
      <div class="flex items-center justify-center h-full p-8">
        <p class="text-ink-500">No workspace loaded.</p>
      </div>,
    );
  }

  const sessionId = c.req.query("session_id") || "";
  const workflowId = c.req.query("workflow_id") || "";
  const action = c.req.query("action") || "";
  const sessionName = c.req.query("session_name") || "";
  const prefill = c.req.query("prefill") || "";
  const todoId = c.req.query("todo_id") || "";
  const wsId = activeShellId(user.userId);

  if (workflowId) {
    await setCurrentWorkflowId(user, workflowId);
  }

  // action=new — create session, then redirect to view or todo
  if (action === "new") {
    const newSession = await createSession(databaseId, "user", "Chat");

    if (todoId && prefill) {
      // Todo click — auto-submit
      const url = shellChatUrl(
        wsId,
        `session_id=${newSession.session_id}&action=todo&prefill=${encodeURIComponent(prefill)}&todo_id=${todoId}`,
      );
      c.header("HX-Push-Url", url);
      return c.html(
        <div
          hx-get={`/sessions/todo-start?session_id=${newSession.session_id}&todo_id=${todoId}&prefill=${encodeURIComponent(prefill)}`}
          hx-trigger="load"
          hx-swap="innerHTML"
        >
          <div class="flex flex-col items-center justify-center h-96">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-leaf-500 mb-4"></div>
            <p class="text-ink-600 dark:text-white/70">Working...</p>
          </div>
        </div>,
      );
    }

    // Regular new chat
    const url = shellChatUrl(
      wsId,
      `session_id=${newSession.session_id}&action=view${prefill ? `&prefill=${encodeURIComponent(prefill)}` : ""}`,
    );
    c.header("HX-Push-Url", url);
    return c.html(
      <div
        hx-get={`/sessions/view?session_id=${newSession.session_id}${prefill ? `&prefill=${encodeURIComponent(prefill)}` : ""}`}
        hx-trigger="load"
        hx-swap="innerHTML"
      >
        <div class="flex flex-col items-center justify-center h-96">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mb-4"></div>
          <p class="text-ink-600 dark:text-white/70">Loading chat...</p>
        </div>
      </div>,
    );
  }

  // action=todo — auto-submit instruction
  if (action === "todo" && sessionId && prefill) {
    return c.html(
      <div
        hx-get={`/sessions/todo-start?session_id=${sessionId}&todo_id=${todoId}&prefill=${encodeURIComponent(prefill)}`}
        hx-trigger="load"
        hx-swap="innerHTML"
      >
        <div class="flex flex-col items-center justify-center h-96">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-leaf-500 mb-4"></div>
          <p class="text-ink-600 dark:text-white/70">Working...</p>
        </div>
      </div>,
    );
  }

  // action=run — start a workflow
  if (workflowId && action === "run") {
    // Make sure we run against the latest persisted data: if another machine
    // or server instance saved since this session last synced, re-hydrate the
    // workspace from Supabase before kicking off the run.
    try {
      await refreshActiveWorkspaceIfStale(databaseId);
    } catch (err) {
      console.error("[sessionView] pre-run freshness check failed:", err);
    }
    return c.html(
      <div
        hx-get={`/sessions/start?workflow_id=${workflowId}${sessionName ? `&session_name=${encodeURIComponent(sessionName)}` : ""}${todoId ? `&todo_id=${todoId}` : ""}`}
        hx-trigger="load"
        hx-swap="innerHTML"
      >
        <div class="flex flex-col items-center justify-center h-96">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-leaf-500 mb-4"></div>
          <p class="text-ink-600 dark:text-white/70">Starting workflow...</p>
        </div>
      </div>,
    );
  }

  // Default: view existing session
  if (sessionId) {
    return c.html(
      <div
        hx-get={`/sessions/view?session_id=${sessionId}${prefill ? `&prefill=${encodeURIComponent(prefill)}` : ""}`}
        hx-trigger="load"
        hx-swap="innerHTML"
      >
        <div class="flex flex-col items-center justify-center h-96">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mb-4"></div>
          <p class="text-ink-600 dark:text-white/70">Loading chat...</p>
        </div>
      </div>,
    );
  }

  // No session or workflow — show empty state
  return c.html(
    <div class="flex items-center justify-center h-full p-8">
      <div class="text-center">
        <p class="text-ink-500">No session selected.</p>
        <button
          hx-get="/app/chat"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          hx-push-url={shellChatListUrl(wsId)}
          class="mt-4 rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-600 border border-brand-200 hover:bg-brand-50 dark:text-brand-300 dark:border-brand-800 dark:hover:bg-brand-900/30"
        >
          Back to Chats
        </button>
      </div>
    </div>,
  );
};
