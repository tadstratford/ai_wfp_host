import { Context } from "hono";
import type { User } from "@backend/types";
import { getRecentSessions } from "@backend/core/session/sessions/session_all";
import { formatJudgeSummary } from "@backend/core/session/judgeSummary";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";
import { getSessionOrigin } from "@backend/core/workspace/workspaceLifecycle";

/**
 * Chat Panel — list of chat sessions, loaded into #main-panel (the shell's Chat
 * section). Session links push the shell URL `/app/w/:id/chat?…` so refresh/back
 * stay in the shell; falls back to the legacy `/app?panel=session` only when no
 * hosted (supabase) workspace is active (disk/blank session).
 */
export const chatPanelView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  const session = getWorkspaceSession(user.userId);
  const origin = session ? getSessionOrigin(session) : undefined;
  const wsId = origin?.kind === "supabase" ? origin.workspaceId : "";
  // Pushed URL for a session view/new/run within the shell.
  const shellChatUrl = (q: string) => (wsId ? `/app/chat?${q}` : `/app?panel=session&${q}`);

  const sessions = databaseId ? getRecentSessions(databaseId, 30) : [];

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Chats</h2>
          <p class="text-sm text-ink-500 mt-1">
            Ask questions, build knowledge packs, or work with your data.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            hx-delete="/app/sessions"
            hx-confirm="Clear all chats? This cannot be undone."
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-coral-600 dark:border-white/[0.1] dark:text-coral-300 dark:hover:bg-white/[0.04] transition"
          >
            Clear all
          </button>
          <button
            hx-get="/app/session?action=new"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-push-url={shellChatUrl("action=new")}
            class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition"
          >
            New Chat
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div class="text-center py-12 text-ink-400 dark:text-ink-500">
          <svg class="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1">
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
          <p class="text-sm">No chats yet.</p>
          <p class="text-xs mt-2">Click <strong>New Chat</strong> to start a conversation.</p>
        </div>
      ) : (
        <div class="space-y-1.5" id="chat-list">
          {sessions.map((s) => {
            const workflow = s.kind === "automation";
            const typeLabel = workflow ? "Workflow" : "Chat";
            const typeClass = workflow
              ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
              : "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white/70";
            const date = s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "";
            const time = s.updated_at
              ? new Date(s.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "";
            const label = s.first_message || s.session_name || (workflow ? "Workflow" : "Chat");
            const subtitle = workflow && s.workflow_name ? s.workflow_name : null;
            const judge = formatJudgeSummary(s.judge_summary);
            const msgCount = s.message_count || 0;

            return (
              <div class="flex items-center justify-between px-4 py-2.5 card rounded-xl hover:border-brand-300 dark:hover:border-brand-700 transition-colors">
                <a
                  hx-get={`/app/session?session_id=${s.session_id}&action=view`}
                  hx-target="#main-panel"
                  hx-swap="innerHTML"
                  hx-push-url={shellChatUrl(`session_id=${s.session_id}&action=view`)}
                  class="flex items-center gap-3 min-w-0 flex-1 no-underline cursor-pointer"
                >
                  <span class={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${typeClass}`}>
                    {typeLabel}
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm text-ink-700 dark:text-white/80 truncate">
                      {label}
                    </span>
                    {subtitle && (
                      <span class="block text-[10px] text-ink-400 dark:text-ink-500 truncate">
                        {subtitle}
                      </span>
                    )}
                    {judge && (
                      <span class="block text-[10px] text-ink-400 dark:text-ink-500 truncate">
                        {judge}
                      </span>
                    )}
                  </span>
                </a>
                <div class="flex items-center gap-3 shrink-0 ml-3">
                  <button
                    hx-delete={`/app/session/${s.session_id}?refresh=chat`}
                    hx-target="#main-panel"
                    hx-swap="innerHTML"
                    hx-confirm="Delete this chat?"
                    class="text-xs text-coral-500 hover:text-coral-600 dark:text-coral-400"
                  >
                    Delete
                  </button>
                  {msgCount > 0 && (
                    <span class="text-[10px] text-ink-400 dark:text-ink-400">
                      {msgCount} msg{msgCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span class="hidden sm:inline text-[10px] text-ink-400 dark:text-ink-400">
                    {date} {time}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
