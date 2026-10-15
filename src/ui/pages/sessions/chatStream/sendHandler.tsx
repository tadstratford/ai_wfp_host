import { Context } from "hono";
import {
  createSession,
  getSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import { executeWorkflow } from "@backend/core/workflow";
import { setCurrentWorkflowId } from "@backend/core/user";
import { addMessage } from "@backend/core/session/messages";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import type { User } from "@backend/types";
import { logActivity } from "@backend/core/models/activityTracker";
import { activeShellId, shellChatUrl } from "@frontend/pages/app/shellUrls";

// ── Message classification shared by the render paths ────────────────────────

function classifyMessageKind(msg: any): string {
  if (msg.role === "user") return "user";
  if (msg.role === "error") return "error";
  if (msg.role === "form") return "form";
  if (msg.role === "form-submitted") return "form-submitted";
  if (msg.json?.kind) return msg.json.kind;
  if (msg.json?.tool) return "tool-call";
  if (msg.source === "system" || msg.json?.system) return "system";
  return "reply";
}

function stripMarkdown(s: string): string {
  return (s || "")
    .replace(/^\s*>\s*/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[_*]\s*|\s*[_*]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Legacy: direct workflow execution send ───────────────────────────────────

export const sendHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const sessionId = body.session_id as string;
  const message = body.message as string;
  const workflowId = body.workflow_id as string;
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!message?.trim()) {
    return c.html(<div></div>);
  }

  try {
    let session;
    let isNewSession = false;

    if (sessionId) {
      session = await getSession(databaseId, sessionId);
      if (!session) {
        return c.html(<div class="text-coral-600">Session not found</div>);
      }
      session = await addMessage({
        databaseId,
        session,
        role: "user",
        source: "user",
        html: `<div>${message}</div>`,
        markdown: message,
      });
    } else {
      session = await createSession(databaseId, "user", "New Chat");
      if (!session.activeWorkflowId && workflowId) {
        await updateSession(databaseId, session.session_id, "workflow_id", workflowId);
        session.activeWorkflowId = workflowId;
      }
      isNewSession = true;
    }

    if (workflowId) {
      await setCurrentWorkflowId(user, workflowId);
      executeWorkflow(databaseId, workflowId, session.session_id, message)
        .then(() => notifyClients(session.session_id, "workflow_complete"))
        .catch((err) => console.error(`[/chat/send] Workflow error:`, err));
    }

    if (isNewSession) {
      const { renderChatContent } = await import("./index");
      return c.html(
        <>
          <span id="chat-url-update" data-session-id={session.session_id} data-url={shellChatUrl(activeShellId(user.userId), `session_id=${session.session_id}&action=view`)} hidden></span>
          {await renderChatContent(user, session, workflowId, session.sessionName, !!workflowId)}
        </>,
      );
    }

    return c.html(
      <div class="space-y-3">
        {session.messages.map((msg: any) => {
          const kind = classifyMessageKind(msg);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const html = msg.html || msg.markdown || "";

          if (kind === "llm-call" || kind === "tool-call" || kind === "meta" || kind === "status" || kind === "system") {
            if (kind === "system") {
              return (
                <div class="flex items-center gap-3 text-[11px] text-ink-400 dark:text-ink-500 py-1">
                  <div class="flex-1 h-px bg-ink/[0.06] dark:bg-white/[0.08]"></div>
                  <span class="truncate">{stripMarkdown(msg.markdown || "") || stripMarkdown(html)}</span>
                  <div class="flex-1 h-px bg-ink/[0.06] dark:bg-white/[0.08]"></div>
                </div>
              );
            }
            return (
              <div class="flex items-start gap-2 text-xs text-ink-400 dark:text-ink-500 py-0.5 pl-3 border-l-2 border-ink/[0.08] dark:border-white/[0.08]">
                <span class="mt-px shrink-0">·</span>
                <span class="min-w-0 truncate">
                  {kind === "llm-call" ? (
                    <span dangerouslySetInnerHTML={{ __html: html }} />
                  ) : kind === "tool-call" ? (
                    `${msg.json?.tool || ""}${msg.json?.iteration != null ? ` \u00b7 iter ${msg.json.iteration}` : ""}`
                  ) : (
                    stripMarkdown(msg.markdown || "") || stripMarkdown(html)
                  )}
                </span>
              </div>
            );
          }

          const label = friendlyLabel(msg.nodeLabel || msg.source || msg.role);
          const headerLabel = kind === "user" ? "You" : label;
          const cardClass = kind === "user"
            ? "rounded-r-lg border-l-4 border-brand-500 bg-brand-50/40 dark:bg-brand-950/30 px-3 py-2"
            : `rounded-lg border px-3 py-2 ${kind === "error" ? "border-coral-200 dark:border-coral-800" : "border-ink/[0.08] dark:border-white/[0.08]"}`;

          return (
            <div class={cardClass}>
              <div class="flex items-center gap-2 mb-1">
                <span class={kind === "user" ? "text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300" : "ds-label"}>
                  {headerLabel}
                </span>
                <span class="ds-label-muted ml-auto">{time}</span>
              </div>
              <div
                class="prose prose-sm prose-slate dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          );
        })}
      </div>,
    );
  } catch (error) {
    return c.html(<div class="text-coral-600">Error: {String(error)}</div>);
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Map raw message sources to a user-facing attribution label. Never surface
 *  "assistant", "vers_6", or "build-agent" — those are orchestrator internals. */
function friendlyLabel(label: string): string {
  if (!label) return "Workflow";
  if (label === "assistant" || label === "vers_6" || label === "build-agent") return "Workflow";
  return label;
}

// ── Main: buildSendHandler ──────────────────────────────────────────────────

export const buildSendHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const sessionId = body.session_id as string;
  const rawMessage = (body.message as string || "").trim();
  const actionValue = body.action as string || "";

  const user = c.get("user") as any;
  const mode = user.currentChatMode || (body.mode as string) || "build";
  const verbose = user.chatVerbose !== false;
  const databaseId = user.currentDatabaseId as string;
  const userId = user.userId as string;

  if (!rawMessage && !actionValue) return c.html(<div></div>);
  if (!databaseId || !sessionId) {
    return c.html(<div class="text-coral-600">Session context is missing. Try refreshing the page.</div>);
  }

  // Activity log
  logActivity(user.userEmail, actionValue === "__approve__" ? "approve_plan" : "chat", rawMessage.substring(0, 200), userId);

  // Verify session exists
  try {
    const session = await getSession(databaseId, sessionId);
    if (!session) {
      return c.html(<div class="text-coral-600">Session not found. Try starting a new session.</div>);
    }
  } catch {
    return c.html(<div class="text-coral-600">Session not found. Try starting a new session.</div>);
  }

  // Fire-and-forget: route message through chat system
  (async () => {
    try {
      const { handleMessage } = await import("@chat/index");
      await handleMessage(
        databaseId,
        sessionId,
        userId,
        rawMessage,
        actionValue,
        mode,
        verbose,
      );
    } catch (err: any) {
      console.error("[sendHandler] handleMessage FAILED:", err.message);
      try {
        const session = await getSession(databaseId, sessionId);
        if (session) {
          const md = `**Something went wrong**\n\n${err.message || String(err)}`;
          await addMessage({
            session,
            databaseId,
            role: "error",
            source: "system",
            markdown: md,
            html: `<div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:16px">
              <div style="color:#991b1b;font-weight:600">Something went wrong</div>
              <div style="color:#374151;margin-top:8px">${err.message || String(err)}</div>
            </div>`,
          });
          notifyClients(sessionId, "new_message");
        }
        await updateSession(databaseId, sessionId, "instance_status", "awaiting_feedback");
        notifyClients(sessionId, "workflow_complete");
      } catch {}
    }
  })();

  // The real message list is rendered by /sessions/api/messages (messagesHandler)
  // via SSE as handleMessage adds messages. Returning a minimal placeholder here
  // avoids racing handleMessage's partial writes (which previously caused the
  // process-details section to flash at the top before settling at the bottom).
  return c.html(
    <div class="flex items-center gap-2 py-3 px-4 text-sm text-ink-500">
      <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></div>
      <span>Working...</span>
    </div>,
  );
};
