import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkflowSessions } from "@backend/core/session/sessions/session_all";
import { listAuditVerdicts, type AuditVerdictSummary, findVerdictBySessionId } from "@backend/core/knowledge/auditLog";
import { activeShellId, shellChatUrl } from "../shellUrls";

/**
 * GET /app/history/:workflowId — returns run history rows for a workflow.
 * Used as an HTMX partial loaded on demand.
 */
export const workflowHistoryHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workflowId = c.req.param("workflowId");

  if (!user.currentDatabaseId || !workflowId) {
    return c.html(<p class="text-sm text-ink-400">No data</p>);
  }

  const sessions = getWorkflowSessions(user.currentDatabaseId, workflowId);
  const verdicts: AuditVerdictSummary[] = await listAuditVerdicts(user.currentDatabaseId);
  const wsId = activeShellId(user.userId);

  if (sessions.length === 0) {
    return c.html(
      <p class="text-sm text-ink-400 dark:text-ink-500">
        No runs yet. Click Run to start.
      </p>,
    );
  }

  return c.html(
    <div id="history-list" class="space-y-2">
      {/* Clear all button */}
      <div class="flex justify-end mb-1">
        <button
          hx-delete={`/app/sessions/${workflowId}`}
          hx-target="#history-list"
          hx-swap="outerHTML"
          hx-confirm="Delete all run history for this workflow?"
          class="text-xs text-ink-400 dark:text-ink-500 hover:text-coral-500 dark:hover:text-coral-400 transition-colors"
        >
          Clear all
        </button>
      </div>

      {sessions.map((s: any) => {
        const status = s.instance_status || "pending";
        const statusLabel: Record<string, string> = {
          completed: "Done",
          satisfied: "Done",
          in_progress: "Running",
          awaiting_feedback: "Your turn",
          pending: "Waiting",
          not_satisfied: "Needs review",
          cancelled: "Cancelled",
          blocked: "Held",
        };
        const statusColors: Record<string, string> = {
          completed: "bg-leaf-50 text-leaf-700 dark:bg-leaf-900/40 dark:text-leaf-300",
          satisfied: "bg-leaf-50 text-leaf-700 dark:bg-leaf-900/40 dark:text-leaf-300",
          in_progress: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300",
          awaiting_feedback: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300",
          pending: "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300",
          not_satisfied: "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300",
          cancelled: "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70",
          blocked: "bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300",
        };
        const colorClass = statusColors[status] || statusColors["pending"];
        const label = statusLabel[status] || status;
        const date = s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "";
        const time = s.updated_at
          ? new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        const sessionVerdict = findVerdictBySessionId(verdicts, s.session_id);

        return (
          <div
            key={s.session_id}
            class="flex flex-wrap items-center justify-between gap-y-2 px-4 py-3 card rounded-xl hover:border-brand-300 dark:hover:border-brand-700 transition-colors group"
          >
            <a
              hx-get={`/app/session?session_id=${s.session_id}&action=view`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              hx-push-url={shellChatUrl(wsId, `session_id=${s.session_id}&action=view`)}
              class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
            >
              <span class={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${colorClass}`}>
                {label}
              </span>
              <span class="text-sm text-ink-700 dark:text-white/80 truncate">
                {s.session_name || "Run"}
              </span>
            </a>
            <div class="flex flex-wrap items-center gap-3 shrink-0">
              <span class="text-xs text-ink-400">
                {date} {time}
              </span>

              {sessionVerdict ? (
                <a
                  href={`/app/session?session_id=${encodeURIComponent(sessionVerdict.sessionId)}&action=view`}
                  class={`text-xs font-medium px-2 py-1 rounded-md transition-all no-underline ${
                    sessionVerdict.verdict === "failed"
                      ? "text-coral-600 bg-coral-50 dark:text-coral-300 dark:bg-coral-900/30 hover:bg-coral-100 dark:hover:bg-coral-900/40"
                      : "text-leaf-600 bg-leaf-50 dark:text-leaf-300 dark:bg-leaf-900/30 hover:bg-leaf-100 dark:hover:bg-leaf-900/40"
                  }`}
                  onclick="event.stopPropagation()"
                >
                  <svg class="w-3 h-3 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  </svg>
                  {sessionVerdict.verdict === "failed" ? "Needs review" : "Correct"}
                </a>
              ) : null}

              <button
                hx-delete={`/app/session/${s.session_id}`}
                hx-target="closest div.group"
                hx-swap="outerHTML"
                hx-confirm="Delete this session?"
                class="opacity-60 hover:opacity-100 focus-visible:opacity-100 text-ink-300 dark:text-ink-500 hover:text-coral-500 dark:hover:text-coral-400 transition-all"
                onclick="event.stopPropagation()"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>,
  );
};
