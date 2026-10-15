import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkspaceItemCounts, getWorkspaceChangelog } from "@backend/core/workspace/itemCounts";
import type { WorkspaceItemCounts, ChangelogEntry } from "@backend/core/workspace/itemCounts";
import { getWorkspaceStatus, type WorkflowStatusCard, type WorkspaceNote } from "@backend/core/workspace/workflowStatus";
import { getWorkflowGroups, type WorkflowGroup } from "@backend/core/overview/workflowGroups";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { getSessionOrigin, refreshActiveWorkspaceIfStale, type SessionOrigin } from "@backend/core/workspace/workspaceLifecycle";

import { createSession, updateSession, getSession } from "@backend/core/session/sessions/session_all";
import { addMessage } from "@backend/core/session/messages";
// handleMessage and focusedModify replaced by graph executor (imported dynamically in handlers)
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { WorkflowModal } from "../../../components/workflowModal";
import { logActivity } from "@backend/core/models/activityTracker";
import { activeShellId, shellChatUrl, shellWorkflowsUrl } from "../shellUrls";

// ── Workspace Page (HTMX partial for #main-panel) ───────────────────────────

export const workspacePageView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const workspaceName = user.workspaceName || "My Workspace";

  // Opening the workflows dashboard: cheaply check the Supabase row version and
  // re-hydrate if another machine/instance saved since we last synced. Usually
  // a no-op (timestamps match) — no blob download, no decrypt.
  if (databaseId) {
    try {
      await refreshActiveWorkspaceIfStale(databaseId);
    } catch (err) {
      console.error("[workspacePageView] freshness check failed:", err);
    }
  }

  const wsId = activeShellId(user.userId);
  const counts = databaseId ? getWorkspaceItemCounts(databaseId) : null;
  const isEmpty = !counts || (counts.workflows === 0 && counts.dataFiles === 0);

  console.log(
    `[workspacePageView] userId=${user.userId} databaseId=${databaseId} ` +
    `workspaceName="${workspaceName}" counts=${JSON.stringify(counts)} isEmpty=${isEmpty}`,
  );

  let status = databaseId ? getWorkspaceStatus(databaseId) : null;
  const groups = databaseId ? getWorkflowGroups(databaseId) : [];

  return c.html(
    <div class="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-8" data-workspace-has-data={isEmpty ? "false" : "true"}>
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">

        {/* Main column */}
        <div class="min-w-0 space-y-6">

          {status?.period && (
            <p class="text-sm text-ink-500 dark:text-ink-400">{status.period}</p>
          )}

          {/* Empty workspace — no workflows yet. */}
          {status && status.totalWorkflows === 0 && (
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <svg class="w-10 h-10 text-ink-300 dark:text-ink-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
              <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-1">
                No workflows yet
              </h2>
              <p class="text-sm text-ink-500 mb-5 max-w-md">
                Describe one task and the AI will build a workflow you can run again
                every period.
              </p>
              <div class="flex flex-wrap items-center gap-3">
                <button
                  hx-get="/app/make-workflow"
                  hx-target="#main-panel"
                  hx-swap="innerHTML"
                  class="flex items-center gap-2 px-4 py-2.5 text-white bg-brand-500 hover:bg-brand-600 rounded-xl text-sm font-semibold transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Make Workflow
                </button>
                <label class="flex items-center gap-2 px-4 py-2.5 text-ink-600 dark:text-white/80 border border-ink/[0.1] dark:border-white/[0.1] hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-xl text-sm font-semibold transition-colors cursor-pointer">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 9h10v10H9zM5 5h10v3M5 5v10h3" />
                  </svg>
                  Copy Workflow
                  <input
                    type="file"
                    name="file"
                    accept=".wfp,application/json"
                    class="hidden"
                    hx-post="/app/copy-from-file/upload"
                    hx-vals='{"kind":"workflow"}'
                    hx-encoding="multipart/form-data"
                    hx-trigger="change"
                    hx-target="#modal-container"
                    hx-swap="innerHTML"
                  />
                </label>
              </div>
              <p class="text-xs text-ink-400 dark:text-ink-500 mt-5">
                Setting up a whole workspace?{" "}
                <button
                  hx-get="/app/modal/new-workspace"
                  hx-target="#modal-container"
                  hx-swap="innerHTML"
                  class="text-brand-600 dark:text-brand-300 hover:underline"
                >
                  Plan a multi-step project
                </button>
              </p>
            </div>
          )}

          {/* Workspace dashboard — shown once at least one workflow exists. */}
          {status && status.totalWorkflows > 0 && (
            <section>
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
                <div class="flex items-center gap-3">
                  <h2 class="text-sm font-bold uppercase tracking-wider text-ink-500">
                    Workflows
                  </h2>
                  <span class="text-xs font-semibold text-ink-400">
                    {status.completedWorkflows} of {status.totalWorkflows} complete
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <button
                    hx-post="/app/workspace/reset-all"
                    hx-target="#main-panel"
                    hx-swap="innerHTML"
                    hx-confirm="Reset every workflow in this workspace? They become ready to run again."
                    class="text-xs text-ink-400 hover:text-ink-600 dark:hover:text-white"
                  >
                    Reset All
                  </button>
                  <button
                    hx-get="/app/make-workflow"
                    hx-target="#main-panel"
                    hx-swap="innerHTML"
                    class="px-3 py-1.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors flex items-center gap-2"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Make Workflow
                  </button>
                  <label class="px-3 py-1.5 text-sm font-semibold text-ink-600 dark:text-white/80 border border-ink/[0.1] dark:border-white/[0.1] hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors flex items-center gap-2 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 9h10v10H9zM5 5h10v3M5 5v10h3" />
                    </svg>
                    Copy Workflow
                    <input
                      type="file"
                      name="file"
                      accept=".wfp,application/json"
                      class="hidden"
                      hx-post="/app/copy-from-file/upload"
                      hx-vals='{"kind":"workflow"}'
                      hx-encoding="multipart/form-data"
                      hx-trigger="change"
                      hx-target="#modal-container"
                      hx-swap="innerHTML"
                    />
                  </label>
                </div>
              </div>

              <div class="space-y-5">
                {groups.map((g) => renderGroupSection(g, wsId))}
              </div>
            </section>
          )}
        </div>

        {/* Right rail */}
        <aside class="space-y-6">
          {status && renderAwaitingCard(status)}
          {renderAuditCard(databaseId)}
        </aside>

      </div>
    </div>
  );
};

/** Render a single group section: header bar + each workflow card. */
function renderGroupSection(g: WorkflowGroup, wsId: string) {
  return (
    <div>
      {/* Group header bar — name + count + Reset button (no ⋮ — rename/remove
          is done by editing each workflow's free-text `group` input). */}
      <div class="flex flex-wrap items-center gap-3 mb-2 px-1">
        <span class="inline-flex items-center justify-center h-5 w-5 rounded bg-ink/[0.05] dark:bg-white/[0.06] text-ink-500 dark:text-white/60 shrink-0">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a1 1 0 0 1 1-1h4l2 2.5h6a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/></svg>
        </span>
        <span class="text-xs font-bold uppercase tracking-wider text-ink-500 dark:text-ink-400">{g.name}</span>
        <span class="text-[11px] font-semibold text-ink-400 dark:text-ink-500">
          {g.completed} of {g.total} complete
        </span>
        <div class="ml-auto flex items-center gap-1">
          {g.canReset ? (
            <button
              hx-post="/app/workflow-group/reset"
              hx-vals={`{"group":"${escapeAttr(g.name)}"}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              hx-confirm={`Reset all ${g.total} workflow${g.total === 1 ? "" : "s"} in this group? They become ready to run again.`}
              class="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-ink-700 dark:bg-white/90 dark:text-ink-900 dark:hover:bg-white transition"
              title="Reset all workflows in this group so they're ready to run again"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 0 1 10.5-4M16 10a6 6 0 0 1-10.5 4M14.5 3.5v3h-3M5.5 16.5v-3h3"/></svg>
              Reset
            </button>
          ) : (
            <span class="inline-flex items-center gap-1.5 rounded-lg bg-ink/[0.05] dark:bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-ink-400 dark:text-ink-500 cursor-not-allowed" title="Nothing to reset in this group">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 0 1 10.5-4M16 10a6 6 0 0 1-10.5 4M14.5 3.5v3h-3M5.5 16.5v-3h3"/></svg>
              Reset
            </span>
          )}
        </div>
      </div>

      <div class="space-y-2">
        {g.workflows.map((wf, i) =>
          renderWorkflowCard(wf, wsId, { isFirst: i === 0, isLast: i === g.workflows.length - 1 }),
        )}
      </div>
    </div>
  );
}

/** Render a single workflow status card with a full ⋮ menu. The free-text
 *  `group` input now lives inside the menu (passive config). */
function renderWorkflowCard(
  wf: WorkflowStatusCard,
  wsId: string,
  opts: { isFirst: boolean; isLast: boolean },
) {
  const statusConfig = getStatusConfig(wf.status);
  const menuId = `wf-menu-${wf.workflowId}`;
  const indentPx = wf.depthLevel > 0 ? wf.depthLevel * 24 : 0;
  const canRun =
    wf.status === "ready" || wf.status === "complete" || wf.status === "stale" || wf.status === "not_run";

  return (
    <div
      class="flex items-center gap-2"
      style={indentPx > 0 ? `margin-left: ${indentPx}px` : ""}
    >
      {/* The bordered card — its whole surface opens the workflow via the
          overlay link; the ⋮ (and its menu) float above it and stay
          interactive (pointer-events-auto) so clicks don't fall through. */}
      <div class="relative flex flex-1 min-w-0 items-center rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors">
        <a
          hx-get={`/app/view/${wf.workflowId}`}
          hx-target="#main-panel"
          hx-swap="innerHTML"
          hx-push-url={shellWorkflowsUrl(wsId, `workflow_id=${wf.workflowId}`)}
          aria-label={`Open ${wf.name}`}
          class="absolute inset-0 z-0"
        ></a>

        <div class="pointer-events-none relative flex flex-1 min-w-0 items-center gap-3 px-3 py-2">
          <div class={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusConfig.dotColor}`}></div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-ink dark:text-white truncate">{wf.name}</span>
              {wf.flagCount > 0 && (
                <span class="text-xs bg-sun-50 dark:bg-sun-900/40 text-sun-600 dark:text-sun-300 px-1.5 py-0.5 rounded">
                  {wf.flagCount} flagged
                </span>
              )}
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-1">
              <span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusConfig.badgeClass}`}>
                {statusConfig.label}
              </span>
              {wf.lastRunDate && wf.status === "complete" && (
                <span class="text-xs text-ink-500 dark:text-ink-400">&middot; {new Date(wf.lastRunDate).toLocaleDateString()}</span>
              )}
              {wf.blockedBy.length > 0 && wf.status === "blocked" && (
                <span class="text-xs text-ink-500 dark:text-ink-400">&middot; waiting on {wf.blockedBy.join(", ")}</span>
              )}
              {wf.missingParams.length > 0 && wf.status === "blocked" && (
                <span class="text-xs text-ink-500 dark:text-ink-400">&middot; needs: {wf.missingParams.join(", ")}</span>
              )}
            </div>
          </div>
        </div>

        {/* Group chip — sits left of the ⋮ so the two don't overlap. */}
        {wf.group && !wf.group.startsWith("(") && (
          <span class="pointer-events-none absolute top-1.5 right-10 text-[10px] bg-brand-50 dark:bg-brand-900/20 text-brand-600 dark:text-brand-300 px-1.5 py-0.5 rounded">
            {wf.group}
          </span>
        )}

        {/* ⋮ — inside the card, top-right. */}
        <button
          type="button"
          data-card-menu-btn={menuId}
          aria-label={`Actions for ${wf.name}`}
          aria-haspopup="menu"
          aria-expanded="false"
          class="pointer-events-auto absolute top-1.5 right-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink/[0.04] dark:text-white/60 dark:hover:text-white dark:hover:bg-white/[0.06] transition"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="20" r="1.5"/></svg>
        </button>
        <div id={menuId} data-card-menu role="menu" class="hidden pointer-events-auto absolute right-2 top-12 z-30 w-56 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-800 p-1 shadow-lg dark:shadow-black/30">
          {canRun && (
            <a data-card-menu-item role="menuitem" hx-get={`/app/session?workflow_id=${wf.workflowId}&action=run`} hx-target="#main-panel" hx-swap="innerHTML" hx-push-url={shellChatUrl(wsId, `workflow_id=${wf.workflowId}&action=run`)} class="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06] rounded-lg">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5 16 10 7 15.5Z"/></svg>
              Run
            </a>
          )}
          <button type="button" data-card-menu-item role="menuitem" hx-post={`/app/workflow/${wf.workflowId}/copy`} hx-target="#main-panel" hx-swap="innerHTML" class="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06] rounded-lg">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h10v10H9zM5 5h10v3M5 5v10h3"/></svg>
            Copy
          </button>
          {(wf.status === "complete" || wf.status === "stale") && (
            <button type="button" data-card-menu-item role="menuitem" hx-post={`/app/workspace/reset-workflow/${wf.workflowId}`} hx-target="#main-panel" hx-swap="innerHTML" class="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06] rounded-lg">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 5-5 5 5 5"/></svg>
              Reset
            </button>
          )}
          <button type="button" data-card-menu-item role="menuitem" disabled={opts.isFirst} aria-disabled={opts.isFirst} class={`flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left rounded-lg ${opts.isFirst ? "text-ink-300 dark:text-white/30 cursor-not-allowed" : "text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06]"}`} hx-post={`/app/workflow/${wf.workflowId}/reorder`} hx-vals='{"direction":"up"}' hx-target="#main-panel" hx-swap="innerHTML">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 5.5-5.5 5.5 5.5"/></svg>
            Move up
          </button>
          <button type="button" data-card-menu-item role="menuitem" disabled={opts.isLast} aria-disabled={opts.isLast} class={`flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left rounded-lg ${opts.isLast ? "text-ink-300 dark:text-white/30 cursor-not-allowed" : "text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06]"}`} hx-post={`/app/workflow/${wf.workflowId}/reorder`} hx-vals='{"direction":"down"}' hx-target="#main-panel" hx-swap="innerHTML">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 7.5 5.5 5.5 5.5-5.5"/></svg>
            Move down
          </button>
          <div class="my-1 border-t border-ink/[0.08] dark:border-white/[0.08]"></div>
          {/* Free-text group input — passive config. Type the same name on multiple workflows to cluster them. */}
          <form hx-post={`/app/workflow/${wf.workflowId}/group`} hx-trigger="change" hx-target="#main-panel" hx-swap="innerHTML" class="px-3 py-2">
            <label class="block text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 mb-1">Group</label>
            <input type="text" name="group" value={wf.group ?? ""} placeholder="(none)" class="w-full px-2 py-1 text-xs border border-ink/[0.08] dark:border-white/[0.08] rounded bg-white dark:bg-ink-900 text-ink-700 dark:text-white placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </form>
          <div class="my-1 border-t border-ink/[0.08] dark:border-white/[0.08]"></div>
          <button type="button" data-card-menu-item role="menuitem" hx-delete={`/app/workflow/${wf.workflowId}`} hx-confirm="Delete this workflow? This cannot be undone." hx-swap="none" class="flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left text-coral-600 hover:bg-coral-50 dark:text-coral-300 dark:hover:bg-coral-900/30 rounded-lg">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function getStatusConfig(status: string): { label: string; dotColor: string; badgeClass: string } {
  switch (status) {
    case "complete": return { label: "Done", dotColor: "bg-leaf-500", badgeClass: "bg-leaf-50 text-leaf-700 dark:bg-leaf-900/40 dark:text-leaf-300" };
    case "running": return { label: "Running", dotColor: "bg-brand-500 animate-pulse", badgeClass: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" };
    case "stale": return { label: "Needs re-run", dotColor: "bg-sun-500", badgeClass: "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300" };
    case "flagged": return { label: "Needs review", dotColor: "bg-sun-500", badgeClass: "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300" };
    case "blocked": return { label: "Held", dotColor: "bg-ink-400", badgeClass: "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70" };
    case "ready": return { label: "Ready", dotColor: "bg-brand-300", badgeClass: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" };
    case "not_run": default: return { label: "Not run", dotColor: "bg-ink-300 dark:bg-white/[0.2]", badgeClass: "bg-ink/[0.05] text-ink-500 dark:bg-white/[0.06] dark:text-white/60" };
  }
}

// ── Right rail cards ─────────────────────────────────────────────────────────

function renderAwaitingCard(status: { workflows: WorkflowStatusCard[] }) {
  const blocked = status.workflows.filter((w) => w.status === "blocked" || w.status === "running");
  if (blocked.length === 0) return <></>;
  return (
    <div class="card border-sun-200 dark:border-sun-800 p-5">
      <div class="flex items-center gap-2 text-sun-600 dark:text-sun-300 mb-3">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
        <h2 class="text-xs font-bold uppercase tracking-wider">Awaiting you</h2>
      </div>
      <ul class="space-y-2">
        {blocked.slice(0, 4).map((wf) => (
          <li class="flex items-start gap-2">
            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sun-500"></span>
            <div class="min-w-0">
              <div class="text-sm font-medium text-ink dark:text-white truncate">{wf.name}</div>
              <div class="text-xs text-ink-500 dark:text-ink-400">
                {wf.status === "running" ? "running"
                  : wf.blockedBy.length > 0 ? `waiting on ${wf.blockedBy.join(", ")}`
                  : wf.missingParams.length > 0 ? `needs: ${wf.missingParams.join(", ")}`
                  : "blocked"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderAuditCard(databaseId: string | null) {
  if (!databaseId) return <></>;
  const entries = getWorkspaceChangelog(databaseId).slice(0, 3);
  if (entries.length === 0) return <></>;
  return (
    <div class="card p-5">
      <div class="flex items-center gap-2 text-ink-600 dark:text-white mb-3">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 19 6v5c0 5-3 8-7 9-4-1-7-4-7-9V6l7-3Z"/></svg>
        <h2 class="text-xs font-bold uppercase tracking-wider">Audit results</h2>
      </div>
      <ul class="space-y-2 text-sm">
        {entries.map((e: ChangelogEntry, i: number) => (
          <li class="flex items-start gap-2">
            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"></span>
            <div class="min-w-0">
              <div class="text-ink-700 dark:text-white/90 truncate">{e.entry}</div>
              <div class="text-xs text-ink-500 dark:text-ink-400">{e.workflow}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Small utilities ──────────────────────────────────────────────────────────

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Workspace Chat Modal (HTMX partial) — shared for New + Modify ────────────

export const workspaceChatModalView = async (c: Context) => {
  const mode = c.req.path.includes("modify") ? "modify" : "new";
  const isModify = mode === "modify";

  const title = isModify ? "Modify Workspace" : "New Workspace";
  const subtitle = isModify
    ? "Describe what you want to add or change in this workspace."
    : "Describe what you want to do. The AI will help you set up your data, knowledge, and workflows.";
  const placeholder = isModify
    ? "e.g., Add a fundraiser tracking workflow, or rename this workspace to Club Finances"
    : "e.g., I want to track my architecture club finances — dues, fundraisers, events, and annual reports by academic year.";
  const buttonText = isModify ? "Modify" : "Go";

  return c.html(
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      id="workspace-chat-modal-backdrop"
    >
      <div class="bg-white dark:bg-ink-800 rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-1">
          {title}
        </h2>
        <p class="text-sm text-ink-500 mb-4">
          {subtitle}
        </p>
        <form
          hx-post="/app/workspace-chat"
          hx-target="#workspace-chat-result"
          hx-swap="innerHTML"
          hx-indicator="#workspace-chat-spinner"
        >
          <input type="hidden" name="mode" value={mode} />
          <textarea
            name="description"
            rows={5}
            placeholder={placeholder}
            required
            autofocus
            class="w-full border border-ink/[0.12] dark:border-white/[0.1] rounded-xl px-3 py-2 text-sm bg-[#F3F5F9] dark:bg-ink-900 text-ink dark:text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 mb-3 overflow-y-auto"
            style="min-height:100px; max-height:300px"
          />
          <div id="workspace-chat-result"></div>
          <div
            id="workspace-chat-spinner"
            class="htmx-indicator flex items-center justify-center gap-2 py-2"
          >
            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></div>
            <span class="text-xs text-ink-400">Starting...</span>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              id="cancel-workspace-chat-modal"
              class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              {buttonText}
            </button>
          </div>
        </form>
      </div>
    </div> as any,
  );
};

// ── Workspace Chat handler (POST) ────────────────────────────────────────────

export const workspaceChatHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!databaseId) {
    return c.html(<div class="text-sm text-coral-600 mb-2">No workspace active.</div>);
  }

  const body = await c.req.parseBody();
  const description = ((body.description as string) || "").trim();
  const isModify = ((body.mode as string) || "") === "modify";
  const chatMode = user.currentChatMode || ((body.chat_mode as string) || "build");
  // Optional forced operation (e.g. "plan" from the empty-workspace prompt).
  // When set, skip triage and route straight to that command.
  const forceCommand = ((body.command as string) || "").trim();

  if (!description) {
    return c.html(<div class="text-sm text-coral-600 mb-2">Please describe what you want.</div>);
  }

  try {
    // 1. Create session
    let session = await createSession(databaseId, user.userId, "Workspace");

    // 2. Add user message (no slash prefix — goes through triage)
    session = await addMessage({
      databaseId,
      session,
      role: "user",
      source: "user",
      html: `<div>${description}</div>`,
      markdown: description,
    });

    // 3. Add immediate feedback message
    session = await addMessage({
      databaseId,
      session,
      role: "assistant",
      source: "build-agent",
      markdown: "Working on it...",
      json: { kind: "status" },
    });

    // 4. Mark session as processing
    await updateSession(databaseId, session.session_id, "instance_status", "in_progress");

    // 5. Fire triage async — LLM will classify and route to /plan, /wf-build, /ask, etc.
    const userId = user.userId;
    const sessionId = session.session_id;

    const ctx = {
      databaseId,
      userId,
      sessionId,
      addMessage: async (msg: { markdown: string; html?: string; json?: Record<string, any>; knowledgeUsed?: Array<{ name: string; scope: string; contentHash: string }> }) => {
        const sess = await getSession(databaseId, sessionId);
        if (sess) {
          await addMessage({
            databaseId, session: sess, role: "assistant", source: "build-agent",
            html: msg.html || "", markdown: msg.markdown, knowledgeUsed: msg.knowledgeUsed, json: msg.json,
          });
          notifyClients(sessionId, "new_message");
        }
      },
      addError: async (title: string, detail?: string) => {
        const sess = await getSession(databaseId, sessionId);
        if (sess) {
          const errBody = detail ? `<div class="text-sm text-ink-700 dark:text-white/80 mt-2">${detail}</div>` : "";
          await addMessage({
            databaseId, session: sess, role: "error", source: "build-agent",
            html: `<div class="bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800 rounded-xl p-4"><div class="text-coral-600 dark:text-coral-300 font-semibold">${title}</div>${errBody}</div>`,
            markdown: detail ? `**${title}**\n\n${detail}` : `**${title}**`,
          });
          notifyClients(sessionId, "new_message");
        }
      },
      setBusy: async () => {
        await updateSession(databaseId, sessionId, "instance_status", "in_progress");
        notifyClients(sessionId, "new_message");
      },
      setDone: async () => {
        await updateSession(databaseId, sessionId, "instance_status", "awaiting_feedback");
        notifyClients(sessionId, "workflow_complete");
      },
    };

    // Route through versioned chat system
    const entryHint = isModify ? "modify-workspace input" : "new-workspace input";
    (async () => {
      try {
        const { handleMessage } = await import("@chat/index");
        let msg = description;
        if (forceCommand && !msg.trim().startsWith("/")) {
          msg = `/${forceCommand} ${msg}`;
        }
        await handleMessage(ctx.databaseId, ctx.sessionId, ctx.userId, msg, "", chatMode, user.chatVerbose !== false);
      } catch (err: any) {
        console.error("[workspace-chat] error:", err);
        await ctx.addError("Error", err.message || String(err));
        await ctx.setDone();
      }
    })();

    // 6. Redirect to session view within app layout
    c.header("HX-Redirect", `/app?panel=session&session_id=${session.session_id}&action=view`);
    return c.text("");
  } catch (err: any) {
    return c.html(<div class="text-sm text-coral-600 mb-2">Error: {err.message || String(err)}</div>);
  }
};

// ── Workflow Modal (HTMX partial — shared for build & modify) ───────────────

export const workflowModalView = async (c: Context) => {
  const workflowId = c.req.query("workflowId") || "";
  const workflowName = c.req.query("workflowName") || "";
  const mode = workflowId ? "modify" : "build";

  return c.html(
    <WorkflowModal mode={mode} workflowId={workflowId || undefined} workflowName={workflowName || undefined} />,
  );
};

// ── Unified Workflow handler (POST) — handles both build & modify ───────────

export const newWorkflowHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!databaseId) {
    return c.html(<div class="text-sm text-coral-600 mb-2">No workspace active.</div>);
  }

  const body = await c.req.parseBody();
  const description = ((body.description as string) || "").trim();
  const workflowId = ((body.workflowId as string) || "").trim();
  const isModify = !!workflowId;

  if (!description) {
    return c.html(<div class="text-sm text-coral-600 mb-2">Please describe what you want.</div>);
  }

  try {
    // 1. Create session
    const sessionName = isModify ? "Modify workflow" : "New Workflow";
    let session = await createSession(databaseId, user.userId, sessionName);

    // 2. Attach workflow_id for modify
    if (isModify) {
      await updateSession(databaseId, session.session_id, "workflow_id", workflowId);
      session.activeWorkflowId = workflowId;
    }

    // 3. Add user message — raw description, no slash prefix. Triage classifies
    //    using the entryHint below so the user never has to type slash syntax.
    session = await addMessage({
      databaseId,
      session,
      role: "user",
      source: "user",
      html: `<div>${description}</div>`,
      markdown: description,
    });

    // 4. Add immediate feedback message
    const feedbackText = isModify
      ? "Working on your changes..."
      : "Working on it...";
    session = await addMessage({
      databaseId,
      session,
      role: "assistant",
      source: "build-agent",
      markdown: feedbackText,
      json: { kind: "status" },
    });

    // 5. Mark session as processing so the UI shows a spinner
    await updateSession(databaseId, session.session_id, "instance_status", "in_progress");

    // 5. Fire pipeline async via triage — SSE will push progress updates
    const userId = user.userId;
    const sessionId = session.session_id;

    const ctx = {
      databaseId,
      userId,
      sessionId,
      workflowId: workflowId || undefined,
      addMessage: async (msg: { markdown: string; html?: string; json?: Record<string, any>; knowledgeUsed?: Array<{ name: string; scope: string; contentHash: string }> }) => {
        const sess = await getSession(databaseId, sessionId);
        if (sess) {
          await addMessage({
            databaseId, session: sess, role: "assistant", source: "build-agent",
            html: msg.html || "", markdown: msg.markdown, knowledgeUsed: msg.knowledgeUsed, json: msg.json,
          });
          notifyClients(sessionId, "new_message");
        }
      },
      addError: async (title: string, detail?: string) => {
        const sess = await getSession(databaseId, sessionId);
        if (sess) {
          const body = detail ? `<div class="text-sm text-ink-700 dark:text-white/80 mt-2">${detail}</div>` : "";
          await addMessage({
            databaseId, session: sess, role: "error", source: "build-agent",
            html: `<div class="bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800 rounded-xl p-4"><div class="text-coral-600 dark:text-coral-300 font-semibold">${title}</div>${body}</div>`,
            markdown: detail ? `**${title}**\n\n${detail}` : `**${title}**`,
          });
          notifyClients(sessionId, "new_message");
        }
      },
      setBusy: async () => {
        await updateSession(databaseId, sessionId, "instance_status", "in_progress");
        notifyClients(sessionId, "new_message");
      },
      setDone: async () => {
        await updateSession(databaseId, sessionId, "instance_status", "awaiting_feedback");
        notifyClients(sessionId, "workflow_complete");
      },
    };

    (async () => {
      try {
        const { handleMessage } = await import("@chat/index");
        const cmd = isModify ? "wf-modify" : "wf-build";
        await handleMessage(ctx.databaseId, ctx.sessionId, ctx.userId, `/${cmd} ${description}`, "", "build", user.chatVerbose !== false);
      } catch (err: any) {
        console.error(`[new-workflow] build error:`, err);
        await ctx.addError("Build error", err.message || String(err));
        await ctx.setDone();
      }
    })();

    // 6. Redirect to session view within app layout — SSE picks up progress
    const redirectUrl = isModify
      ? `/app?panel=session&workflow_id=${workflowId}&session_id=${session.session_id}&action=view`
      : `/app?panel=session&session_id=${session.session_id}&action=view`;
    c.header("HX-Redirect", redirectUrl);
    return c.text("");
  } catch (err: any) {
    return c.html(<div class="text-sm text-coral-600 mb-2">Error: {err.message || String(err)}</div>);
  }
};

// ── Feedback Modal ────────────────────────────────────────────────────────────

// ── Workflow Status Reset ────────────────────────────────────────────────────

export const resetWorkflowHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const workflowId = c.req.param("workflowId");
    const { resetWorkflowStatus } = await import("@backend/core/workspace/workflowStatus");
    resetWorkflowStatus(databaseId, workflowId);

    return workspacePageView(c);
  } catch (err: any) {
    console.error("[Reset workflow]", err);
    return c.text("Error: " + err.message, 500);
  }
};

/**
 * Set (or clear) a workflow's nav group — the editable "group" column on the
 * workflows board. A non-empty group surfaces the workflow as a page in the
 * left-nav section of that name (see workflowGroupNavs); blank keeps it
 * board-only. Deterministic — no LLM. Refreshes the page so the board chip and
 * the left-nav both reflect the change.
 */
export const setWorkflowGroupHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const workflowId = c.req.param("workflowId");
    const body = await c.req.parseBody();
    const group = ((body.group as string) || "").trim();

    const { requireSessionByDatabaseId } = await import("@backend/core/workspace/workspaceSessionStore");
    const ws = requireSessionByDatabaseId(databaseId);
    const wf = ws.getWorkflow(workflowId);
    if (!wf) return c.text("Workflow not found", 404);

    ws.upsertWorkflow({ ...wf, group: group || undefined, updated_at: new Date().toISOString() });

    return workspacePageView(c);
  } catch (err: any) {
    console.error("[Set workflow group]", err);
    return c.text("Error: " + err.message, 500);
  }
};

/**
 * Copy a workflow — duplicates it (nodes + nav group) under a new "(copy)" name.
 * Deterministic; refreshes the board so the copy appears.
 */
export const copyWorkflowHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const workflowId = c.req.param("workflowId");
    const { getWorkflowById, copyWorkflow } = await import("@backend/core/workflow");
    const source = await getWorkflowById(databaseId, workflowId);
    if (!source) return c.text("Workflow not found", 404);

    const newId = await copyWorkflow(databaseId, workflowId, `${source.name} (copy)`);
    if (!newId) return c.text("Copy failed", 500);

    return workspacePageView(c);
  } catch (err: any) {
    console.error("[Copy workflow]", err);
    return c.text("Error: " + err.message, 500);
  }
};

export const resetAllWorkflowsHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const { resetAllWorkflowStatuses } = await import("@backend/core/workspace/workflowStatus");
    resetAllWorkflowStatuses(databaseId);

    return workspacePageView(c);
  } catch (err: any) {
    console.error("[Reset all workflows]", err);
    return c.text("Error: " + err.message, 500);
  }
};

