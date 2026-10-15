import { Context } from "hono";
import type { User } from "@backend/types";
import { getRecentSessions } from "@backend/core/session/sessions/session_all";
import { formatJudgeSummary } from "@backend/core/session/judgeSummary";
import { activeShellId, shellChatUrl } from "@frontend/pages/app/shellUrls";

/**
 * GET /sessions/api/history — returns recent chat sessions list.
 * Excludes the current session (passed via query param) so it's not duplicated.
 */
export const chatHistoryHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const currentSessionId = c.req.query("current");

  if (!databaseId) {
    return c.html(<p class="text-sm text-ink-400">No workspace loaded</p>);
  }

  const wsId = activeShellId(user.userId);
  const sessions = getRecentSessions(databaseId, 30);

  // Exclude the current session from the list if needed
  const previous = currentSessionId
    ? sessions.filter(s => s.session_id !== currentSessionId)
    : sessions;

  if (previous.length === 0) {
    return c.html(
      <div id="chat-history-list" class="text-center py-8 text-ink-400 dark:text-ink-500 text-sm">
        No previous chats yet
      </div>
    );
  }

  return c.html(
    <div id="chat-history-list" class="space-y-1.5">
      {previous.map((s) => {
        const workflow = s.kind === "automation";
        const typeLabel = workflow ? "Workflow" : "Chat";
        const typeClass = workflow
          ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
          : "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70";
        const date = s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "";
        const time = s.updated_at
          ? new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";
        const preview = s.first_message || null;
        const label = preview || s.session_name || (workflow ? "Workflow" : "Chat");
        const subtitle = workflow && s.workflow_name ? s.workflow_name : null;
        const judge = formatJudgeSummary(s.judge_summary);
        const msgCount = s.message_count || 0;

        return (
          <div class="flex items-center justify-between px-4 py-2.5 card rounded-xl hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
            <a
              hx-get={`/app/session?session_id=${s.session_id}&action=view`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              hx-push-url={shellChatUrl(wsId, `session_id=${s.session_id}&action=view`)}
              class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer no-underline"
            >
              <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${typeClass}`}>
                {typeLabel}
              </span>
              <div class="min-w-0">
                <div class="text-sm text-ink-700 dark:text-white/80 truncate">
                  {label}
                </div>
                {subtitle && (
                  <div class="text-[10px] text-ink-400 dark:text-ink-500 truncate">
                    {subtitle}
                  </div>
                )}
                {judge && (
                  <div class="text-[10px] text-ink-400 dark:text-ink-500 truncate">
                    {judge}
                  </div>
                )}
              </div>
            </a>
            <div class="flex items-center gap-3 shrink-0 ml-3">
              <button
                hx-delete={`/sessions/sessions/${s.session_id}?current=${encodeURIComponent(currentSessionId || "")}`}
                hx-target="#chat-history-list"
                hx-swap="innerHTML"
                hx-confirm={`Delete this chat?`}
                class="text-xs text-coral-500 hover:text-coral-600 dark:text-coral-400"
              >
                Delete
              </button>
              {msgCount > 0 && (
                <span class="text-[10px] text-ink-400 dark:text-ink-500">
                  {msgCount} msg{msgCount !== 1 ? "s" : ""}
                </span>
              )}
              <span class="hidden sm:inline text-[10px] text-ink-400 dark:text-ink-500">
                {date} {time}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
