import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkflowById } from "@backend/core/workflow";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import { activeShellId, shellChatUrl } from "../shellUrls";
import { renderShell, pushUrl } from "../workspace/shellPage";

/**
 * Workflow view panel — renders the workflow description + run button + inline history.
 * Returned as an HTMX partial for #main-panel, or as a full shell on direct navigation.
 */
export const workflowViewPanel = async (c: Context) => {
  const user = c.get("user") as User;
  const workflowId = c.req.param("workflowId");

  if (!user.currentDatabaseId || !workflowId) {
    return c.html(<div class="p-8 text-ink-400">Workflow not found</div>);
  }

  const workflow = await getWorkflowById(user.currentDatabaseId, workflowId) as any;
  if (!workflow) {
    return c.html(<div class="p-8 text-ink-400">Workflow not found</div>);
  }

  const descriptionHtml = markdownToHtml(workflow.description || "");

  const nodes = [...(workflow.nodes ?? [])].sort(
    (a: any, b: any) => (a.step_order ?? 0) - (b.step_order ?? 0),
  );

  const content = (
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      {/* Header with run button */}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div class="min-w-0 flex-1 sm:mr-4">
          <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">
            {workflow.name}
          </h1>
          {workflow.summary && (
            <p class="text-sm text-ink-500 mt-1">
              {workflow.summary}
            </p>
          )}
        </div>
        <div class="flex flex-wrap items-center gap-2 shrink-0">
          <button
            hx-get="/app/make-workflow"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Make Workflow
          </button>
          <button
            hx-get={`/app/modify-workflow/${workflow.id}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
            Modify
          </button>
          <a
            hx-get={`/app/session?workflow_id=${workflow.id}&action=run&session_name=${encodeURIComponent(workflow.name)}`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-push-url={shellChatUrl(activeShellId(user.userId), `workflow_id=${workflow.id}&action=run&session_name=${encodeURIComponent(workflow.name)}`)}
            class="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                clip-rule="evenodd"
              />
            </svg>
            Run
          </a>
        </div>
      </div>

      {/* Workflow description */}
      <div
        class="prose dark:prose-invert prose-sm max-w-none card p-6"
        dangerouslySetInnerHTML={{ __html: descriptionHtml }}
      />

      {/* Steps */}
      <div class="mt-8">
        <h2 class="text-sm font-bold text-ink-500 uppercase tracking-wider mb-3">
          Steps ({nodes.length})
        </h2>
        <ol class="space-y-2">
          {nodes.length === 0 ? (
            <li class="text-sm text-ink-400 dark:text-ink-500">No steps.</li>
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

      {/* Inline run history — loaded from shared history panel */}
      <div class="mt-8">
        <h2 class="text-sm font-bold text-ink-500 uppercase tracking-wider mb-3">
          Run History
        </h2>
        <div
          hx-get={`/app/history/${workflow.id}`}
          hx-trigger="load"
          hx-swap="innerHTML"
          class="text-sm text-ink-400"
        >
          Loading...
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
