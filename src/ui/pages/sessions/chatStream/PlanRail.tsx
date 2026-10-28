import type { FC } from "hono/jsx";
import { Context } from "hono";
import type { User } from "@backend/types";
import { getSession } from "@backend/core/session/sessions/session_all";

export interface PlanStep {
  label: string;
  tool_id: string;
}

const iconFor = (status?: string) => {
  if (status === "done") return <span class="text-leaf-500">✓</span>;
  if (status === "running") return <span class="text-brand-500">▶</span>;
  if (status === "error") return <span class="text-coral-400">✗</span>;
  return <span class="text-ink-300 dark:text-ink-600">○</span>;
};

/**
 * PlanRail — the live turn-plan checklist for the chat right rail. Shows the
 * data steps of the latest `plan` message, each annotated with the most recent
 * `step-status` marker. Collapsed by default, matching the other rail cards.
 */
export const PlanRail: FC<{
  steps: PlanStep[];
  statusByIndex: Record<number, string>;
}> = ({ steps, statusByIndex }) => {
  return (
    <details class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-ink-900/40 p-4">
      <summary class="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
        Plan
      </summary>
      {steps.length === 0 ? (
        <p class="text-xs text-ink-400 dark:text-ink-500 mt-3">No plan</p>
      ) : (
        <ol class="space-y-1 mt-3">
          {steps.map((s, i) => (
            <li class="flex items-start gap-2 text-sm text-ink-600 dark:text-white/80">
              <span class="w-4 text-center font-semibold shrink-0">{iconFor(statusByIndex[i])}</span>
              <span class={statusByIndex[i] === "error" ? "text-coral-600 dark:text-coral-400 font-medium" : ""}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
};

/**
 * GET /sessions/api/plan — render the turn-plan checklist for the chat right
 * rail. Returns the latest `plan` message's data steps plus the `step-status`
 * markers emitted after it; shows a "No plan" placeholder before any plan exists.
 */
export const planHandler = async (c: Context) => {
  const sessionId = c.req.query("sessionId") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId || !databaseId) return c.html(<PlanRail steps={[]} statusByIndex={{}} />);

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.html(<PlanRail steps={[]} statusByIndex={{}} />);

  const allMsgs = (session.messages ?? []).filter((m: any) => !m?.json?.postMortem);

  let planIdx = -1;
  for (let i = allMsgs.length - 1; i >= 0; i--) {
    if (allMsgs[i].json?.kind === "plan") { planIdx = i; break; }
  }
  if (planIdx < 0) return c.html(<PlanRail steps={[]} statusByIndex={{}} />);

  const planJson = (allMsgs[planIdx].json ?? {}) as any;
  const steps: PlanStep[] = Array.isArray(planJson.steps) ? planJson.steps : [];
  const statusByIndex: Record<number, string> = {};
  for (let i = planIdx + 1; i < allMsgs.length; i++) {
    const j = allMsgs[i].json as any;
    if (j?.kind === "step-status" && Number.isInteger(j.index)) {
      statusByIndex[j.index] = j.status;
    }
  }

  return c.html(<PlanRail steps={steps} statusByIndex={statusByIndex} />);
};
