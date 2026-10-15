import { Context } from "hono";
import type { User } from "@backend/types";
import { runBuildPipeline } from "@backend/core/process_manager/build-pipeline";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";

/**
 * Plan-first workflow creation (the reliable path).
 *
 * 1. POST /app/new-workflow        → runBuildPipeline Stage 1 (planner) → swap
 *    the whole modal with the plan for approval (Approve & build / Cancel).
 * 2. POST /app/new-workflow/build  → runBuildPipeline Stages 2-4 with the
 *    approved plan → build tools + wire nodes + audit + test.
 *
 * Each step swaps `#modal-container` (never a nested form) so the browser can't
 * mangle the markup. The pending plan is held in memory between the two
 * requests, keyed by a random planId in a hidden field.
 */

const pendingPlans = new Map<string, { plan: unknown; params: Record<string, unknown> }>();

const closeModalJs =
  "var mc=document.getElementById('modal-container'); if(mc){ mc.innerHTML=''; mc.classList.add('hidden'); }";

/** Full-screen modal overlay — swapped into #modal-container. */
const NewWorkflowShell = (props: { children?: any }) => (
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    id="new-workflow-modal-backdrop"
  >
    <div class="bg-white dark:bg-ink-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[90vh] flex flex-col">
      {props.children}
    </div>
  </div>
);

const closeBtnClass =
  "rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors";

const NewWorkflowError = (props: { message: string }) => (
  <NewWorkflowShell>
    <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-3">Make Workflow</h2>
    <div class="text-sm text-coral-600 mb-4">{props.message}</div>
    <div class="flex justify-end">
      <button type="button" id="cancel-new-workflow-modal" class={closeBtnClass}>
        Close
      </button>
    </div>
  </NewWorkflowShell>
);

export const newWorkflowPlanHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<NewWorkflowError message="No workspace active." />);
  }

  const body = await c.req.parseBody();
  const description = ((body.description as string) || "").trim();
  if (!description) {
    return c.html(<NewWorkflowError message="Please describe what you want." />);
  }

  const llmConfig = await getLLMConfigByDatabaseId(databaseId, user.userId);
  const params = {
    userMessage: description,
    databaseId,
    userId: user.userId,
    llmConfig: { provider: llmConfig.provider, model: llmConfig.model, apiKey: llmConfig.apiKey },
  };

  try {
    const stage1 = await runBuildPipeline(params);
    if (!stage1.pendingPlan) {
      return c.html(<NewWorkflowError message="Planning failed." />);
    }
    const planId = crypto.randomUUID();
    pendingPlans.set(planId, { plan: stage1.pendingPlan, params });

    return c.html(
      <NewWorkflowShell>
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-3">Review your plan</h2>
        <div
          class="prose dark:prose-invert prose-sm max-w-none mb-4 max-h-[50vh] overflow-y-auto bg-[#F3F5F9] dark:bg-ink-900 rounded-xl p-4"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(stage1.text || "") }}
        />
        <div
          id="new-workflow-spinner"
          class="htmx-indicator flex items-center justify-center gap-2 py-1"
        >
          <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></div>
          <span class="text-xs text-ink-400">Building...</span>
        </div>
        <form
          hx-post="/app/new-workflow/build"
          hx-target="#modal-container"
          hx-swap="innerHTML"
          hx-indicator="#new-workflow-spinner"
          class="flex items-center justify-end gap-2"
        >
          <input type="hidden" name="planId" value={planId} />
          <button type="button" id="cancel-new-workflow-modal" class={closeBtnClass}>
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Approve &amp; build
          </button>
        </form>
      </NewWorkflowShell>,
    );
  } catch (err: any) {
    return c.html(<NewWorkflowError message={`Error: ${err.message || String(err)}`} />);
  }
};

export const newWorkflowBuildHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const planId = ((body.planId as string) || "").trim();
  const pending = pendingPlans.get(planId);
  if (!pending) {
    return c.html(<NewWorkflowError message="Plan expired — please start again." />);
  }
  pendingPlans.delete(planId);

  try {
    const stage2 = await runBuildPipeline({
      ...(pending.params as any),
      approvedPlan: pending.plan,
    });
    const wfId = stage2.workflowId || "";
    return c.html(
      <NewWorkflowShell>
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-3">Workflow built</h2>
        <div class="whitespace-pre-wrap text-sm text-ink-700 dark:text-white/80 mb-4">
          {stage2.text}
        </div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" id="cancel-new-workflow-modal" class={closeBtnClass}>
            Close
          </button>
          {wfId && (
            <a
              hx-get={`/app/view/${wfId}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              hx-on--after-request={closeModalJs}
              class="inline-block px-4 py-2.5 text-sm font-semibold text-white bg-leaf-500 hover:bg-leaf-600 rounded-xl transition-colors"
            >
              View workflow
            </a>
          )}
        </div>
      </NewWorkflowShell>,
    );
  } catch (err: any) {
    return c.html(<NewWorkflowError message={`Build failed: ${err.message || String(err)}`} />);
  }
};
