import { Context } from "hono";
import type { User } from "@backend/types";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import {
  createSession,
  getSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import { renderChatContent } from "@frontend/pages/sessions/chatStream/index";
import { renderShell, pushUrl } from "../workspace/shellPage";

/**
 * GET /app/workflow/:workflowId/edit — two-panel "edit workflow" view.
 *
 * Left panel: a live, read-only view of the workflow (description + ordered
 * steps). Right panel: a chat session linked to the workflow. The chat runs the
 * vers_6 orchestrator (MCP tool-calling build) and modifies the workflow via
 * MCP tools; the session is a normal workflow session, so it shows in Run
 * History. "Refresh" re-reads the workflow after the agent makes changes.
 */
export const workflowEditView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const workflowId = c.req.param("workflowId");

  const ws = databaseId ? getSessionByDatabaseId(databaseId) : null;
  const workflow = ws?.getWorkflow(workflowId);
  if (!workflow) {
    return c.html(<div class="p-8 text-ink-400">Workflow not found</div>);
  }

  // Reuse an existing edit session, or create one linked to this workflow.
  let sessionId = c.req.query("session_id") || "";
  let session = sessionId ? await getSession(databaseId, sessionId) : null;
  if (!session) {
    session = await createSession(databaseId, user.userId, `Edit: ${workflow.name}`);
    sessionId = session.session_id;
    await updateSession(databaseId, sessionId, "workflow_id", workflowId);
    session.activeWorkflowId = workflowId;
  }

  const descriptionHtml = markdownToHtml(workflow.description?.trim() || "*No description yet.*");

  const nodes = [...(workflow.nodes ?? [])].sort(
    (a: any, b: any) => (a.step_order ?? 0) - (b.step_order ?? 0),
  );

  const content = (
    <div class="min-h-0 flex flex-col lg:h-full">
      <div class="min-h-0 grid grid-cols-1 lg:h-full lg:grid-cols-2">
        {/* ── Left: live workflow view ─────────────────────────────────── */}
        <div class="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r border-ink/[0.07] dark:border-white/[0.07]">
          <div class="p-4 md:p-6">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white">
                  {workflow.name}
                </h2>
                <p class="text-xs text-ink-500">
                  Workflow — modify via the chat on the right
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <a
                  hx-get={`/app/workflow/${workflow.id}/edit?session_id=${sessionId}`}
                  hx-target="#main-panel"
                  hx-swap="innerHTML"
                  class="rounded-lg bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Refresh
                </a>
                <a
                  hx-get={`/app/view/${workflow.id}`}
                  hx-target="#main-panel"
                  hx-swap="innerHTML"
                  class="rounded-lg border border-ink/[0.1] dark:border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-ink-600 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] transition-colors"
                >
                  View workflow
                </a>
                <a
                  hx-get={`/app/session?workflow_id=${workflow.id}&action=run&session_name=${encodeURIComponent(workflow.name)}`}
                  hx-target="#main-panel"
                  hx-swap="innerHTML"
                  class="rounded-lg bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Run
                </a>
              </div>
            </div>

            <div class="card p-5 mb-4">
              <div
                class="prose dark:prose-invert prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            </div>

            <h3 class="text-xs font-bold text-ink-500 uppercase tracking-wider mb-2">
              Steps ({nodes.length})
            </h3>
            <ol class="space-y-2">
              {nodes.length === 0 ? (
                <li class="text-sm text-ink-400 dark:text-ink-500">
                  No steps yet — ask the chat to add nodes.
                </li>
              ) : (
                nodes.map((n: any, i: number) => (
                  <li class="flex items-start gap-3 card rounded-xl p-3">
                    <span class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-ink/[0.05] dark:bg-white/[0.06] text-xs font-semibold text-ink-600 dark:text-white/80">
                      {i + 1}
                    </span>
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-ink dark:text-white">
                        {n.label || "Untitled step"}
                      </div>
                      <div class="text-xs text-ink-500 font-mono truncate">
                        {n.tool_id}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ol>
          </div>
        </div>

        {/* ── Right: Chat session ────────────────────────────────────── */}
        <div class="min-h-0 overflow-y-auto flex flex-col">
          {await renderChatContent(
            user,
            session,
            workflowId,
            workflow.name,
            false,
          )}
        </div>
      </div>
    </div>
  );

  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Push-Url", pushUrl(c));
    return c.html(<>{content}</>);
  }

  return c.html(renderShell(user, user.currentDatabaseId, "overview", pushUrl(c)));
};
