import { Context } from "hono";
import type { User } from "@backend/types";
import { getSession } from "@backend/core/session/sessions/session_all";
import { runBuildPipeline } from "@backend/core/process_manager/build-pipeline";
import { specFromSession } from "@backend/core/process_manager/sessionSpec";
import { buildFromToolCalls } from "@backend/core/process_manager/deterministicBuild";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";

/**
 * "Save as workflow" — convert a chat session into a reusable workflow.
 *
 * Reuses runBuildPipeline with the conversion planner (`pipeline/planner-convert`):
 *   1. POST /sessions/save-as-workflow        → Stage 1 (convert) → review.
 *   2. POST /sessions/save-as-workflow/build  → Stages 2-4 (build tools + wire + test).
 */

const pendingPlans = new Map<
  string,
  { plan: unknown; params: Record<string, unknown>; sessionId: string }
>();

const shell = "max-w-2xl mx-auto px-4 py-6 md:py-8";
const card = "card p-6 md:p-8";
const btnGhost =
  "rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors no-underline";
const btnPrimary =
  "rounded-xl bg-brand-500 hover:bg-brand-400 px-4 py-2.5 text-sm font-semibold text-white transition-colors";

function Err(props: { message: string }) {
  return (
    <div class={shell}>
      <div class={card}>
        <div class="text-sm text-coral-600 dark:text-coral-300 mb-4">{props.message}</div>
        <a href="#" onclick="history.back(); return false;" class={btnGhost}>
          Back
        </a>
      </div>
    </div>
  );
}

function reviewView(
  planId: string,
  sessionId: string,
  stage1: {
    pendingPlan?: unknown;
    text?: string;
    unresolvedInputs?: string[];
  },
) {
  const plan = stage1.pendingPlan as any;
  const name = plan?.workflowName || "Workflow";
  const description = plan?.workflowDescription || stage1.text || "";
  const nodes: any[] = (plan?.nodes || []).filter(
    (n: any) => n.toolId !== "workflow_start" && n.toolId !== "workflow_end",
  );
  const unresolved = stage1.unresolvedInputs ?? [];

  return (
    <div class={shell}>
      <div class={card}>
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">{name}</h1>
          <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
            converted from chat
          </span>
        </div>

        {unresolved.length > 0 && (
          <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <div class="font-semibold mb-1">Unresolved inputs</div>
            <div>
              This plan references data that isn't loaded or produced:{" "}
              {unresolved.map((n) => `\`{{${n}}}\``).join(", ")}. Approving it will fail at run
              time. Go back and load the missing data, or re-run the conversion.
            </div>
          </div>
        )}

        <p class="text-sm text-ink-500 mb-5">
          A draft of the workflow inferred from your session. Nothing has run yet. Approve it, or go
          back.
        </p>

        <div
          class="prose dark:prose-invert prose-sm max-w-none max-h-[40vh] overflow-y-auto bg-[#F3F5F9] dark:bg-ink-800 rounded-lg p-4"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(description) }}
        />

        {nodes.length > 0 && (
          <details class="mt-4 group">
            <summary class="cursor-pointer text-xs font-semibold text-ink-400 hover:text-ink-500 select-none">
              Show the steps
            </summary>
            <div class="mt-3 space-y-4">
              <div>
                <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-1">
                  Steps
                </div>
                <ol class="space-y-1.5">
                  {nodes.map((n: any, i: number) => (
                    <li class="flex items-start gap-2">
                      <span class="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 text-xs font-bold">
                        {i + 1}
                      </span>
                      <span class="text-sm text-ink-700 dark:text-white/80">{n.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </details>
        )}

        <form
          hx-post="/sessions/save-as-workflow/build"
          hx-target="#main-panel"
          hx-swap="innerHTML"
          class="flex items-center justify-end gap-2 mt-5"
        >
          <input type="hidden" name="planId" value={planId} />
          <a
            hx-get={`/app/session?session_id=${sessionId}&action=view`}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class={btnGhost}
          >
            Cancel
          </a>
          <button type="submit" class={btnPrimary}>
            Approve &amp; build
          </button>
        </form>
      </div>
    </div>
  );
}

function builtView(stage2: any, wfId: string) {
  return (
    <div class={shell}>
      <div class={card}>
        <h1 class="text-xl font-extrabold tracking-tight text-ink dark:text-white">Workflow built</h1>
        <p class="text-sm text-ink-500 mt-1">Written down in plain steps, tested, and ready to run.</p>

        {stage2.text && (
          <div class="whitespace-pre-wrap text-sm text-ink-700 dark:text-white/80 mt-4">{stage2.text}</div>
        )}

        <div class="flex items-center justify-end gap-2 mt-5">
          <a
            hx-get="/app/overview"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class={btnGhost}
          >
            Done
          </a>
          {wfId && (
            <a
              hx-get={`/app/view/${wfId}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class={btnPrimary}
            >
              View workflow
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export const saveAsWorkflowPlanHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<Err message="No workspace active." />);

  const sessionId = c.req.query("session_id") || "";
  if (!sessionId) return c.html(<Err message="Missing session_id." />);

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.html(<Err message="Session not found." />);

  const userMessages = (session.messages ?? []).filter(
    (m) => m.role === "user" && (m.markdown || "").trim(),
  );
  const toolCalls = (session.metadata as any)?.toolCalls;
  if (userMessages.length === 0 && !(Array.isArray(toolCalls) && toolCalls.length > 0)) {
    return c.html(<Err message="This session is empty — there's nothing to convert into a workflow." />);
  }

  // Deterministic fast-path: reconstruct the workflow straight from the durable
  // tool-call flags (no LLM), collecting run-time parameters into the start node.
  const deterministic = buildFromToolCalls(
    databaseId,
    (session.metadata as any)?.toolCalls,
  );
  if (deterministic) {
    const paramCount = Object.keys(deterministic.params).length;
    return c.html(
      builtView(
        {
          text: `Built deterministically from your session — no re-plan needed.${
            paramCount > 0
              ? ` ${paramCount} parameter(s) were collected into the start node with your session's values as defaults (edit them there).`
              : " No run-time parameters were detected."
          }`,
        },
        deterministic.workflowId,
      ),
    );
  }

  const spec = specFromSession(session, databaseId);

  const llmConfig = await getLLMConfigByDatabaseId(databaseId, user.userId);
  const params = {
    userMessage: spec,
    databaseId,
    userId: user.userId,
    llmConfig: { provider: llmConfig.provider, model: llmConfig.model, apiKey: llmConfig.apiKey },
    plannerPrompt: "pipeline/planner-convert",
  };

  try {
    const stage1 = await runBuildPipeline(params);
    if (!stage1.pendingPlan) {
      return c.html(<Err message="Planning failed." />);
    }
    const planId = crypto.randomUUID();
    pendingPlans.set(planId, { plan: stage1.pendingPlan, params, sessionId });
    return c.html(reviewView(planId, sessionId, stage1));
  } catch (err: any) {
    return c.html(<Err message={`Error: ${err.message || String(err)}`} />);
  }
};

export const saveAsWorkflowBuildHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const planId = ((body.planId as string) || "").trim();
  const pending = pendingPlans.get(planId);
  if (!pending) return c.html(<Err message="Plan expired — please start again." />);
  pendingPlans.delete(planId);

  try {
    const stage2 = await runBuildPipeline({
      ...(pending.params as any),
      approvedPlan: pending.plan,
    });
    const wfId = stage2.workflowId || "";
    return c.html(builtView(stage2, wfId));
  } catch (err: any) {
    return c.html(<Err message={`Build failed: ${err.message || String(err)}`} />);
  }
};
