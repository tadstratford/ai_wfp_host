import { Context } from "hono";

import {
  getSession,
  createSession,
  updateSession,
} from "@backend/core/session/sessions/session_all";
import { addMessage } from "@backend/core/session/messages";
import { executeWorkflow } from "@backend/core/workflow";
import { getWorkflowById } from "@backend/core/workflow";
import { setCurrentWorkflowId } from "@backend/core/user";
import type { User } from "@backend/types";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { logActivity } from "@backend/core/models/activityTracker";
import { getTodo, updateTodoStatus } from "@backend/core/workspace/todoStore";
import {
  activeShellId,
  shellChatListUrl,
  shellChatUrl,
} from "@frontend/pages/app/shellUrls";
import { Composer } from "./composer";
import { SavedPrompts } from "./SavedPrompts";
import { Capabilities } from "./Capabilities";
import { DataRefs } from "./DataRefs";
import { listSavedPrompts } from "@backend/core/workspace/savedPrompts";
import { listUserData } from "@backend/core/user-data/index";
import { listEmails } from "@backend/core/workspace/emailInbox/store";
import { listSentEmails } from "@backend/core/workspace/emailInbox/outbound";

/**
 * Start a workflow — creates a session and returns the chat UI (loaded into the
 * shell's #main-panel via /app/session).
 */
export const startWorkflowChat = async (c: Context) => {
  const workflowId = c.req.query("workflow_id");
  const sessionName = c.req.query("session_name"); // Get from URL parameter
  const todoId = c.req.query("todo_id") || ""; // set when launched from a "workflow" todo
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!workflowId) {
    return c.html(
      <div class="p-6 rounded-lg bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800">
        <h2 class="font-semibold text-coral-600 dark:text-coral-300">
          Missing Workflow ID
        </h2>
        <a href="/app" class="mt-4 inline-block text-brand-500 hover:underline">
          ← Back to Workflows
        </a>
      </div>,
    );
  }

  const workflow = await getWorkflowById(databaseId, workflowId);
  if (!workflow) {
    return c.html(
      <div class="p-6 rounded-lg bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800">
        <h2 class="font-semibold text-coral-600 dark:text-coral-300">
          Workflow Not Found
        </h2>
        <a href="/app" class="mt-4 inline-block text-brand-500 hover:underline">
          ← Back to Workflows
        </a>
      </div>,
    );
  }

  await setCurrentWorkflowId(user, workflowId);

  // Generate a new Session ID
  const newSessionId = crypto.randomUUID();

  // Use provided session name or generate default
  const finalSessionName =
    sessionName ||
    `${workflow.name} - ${new Date().toISOString().split("T")[0]}`;

  console.log(`[startWorkflowChat] Session name from URL: "${sessionName}"`);
  console.log(`[startWorkflowChat] Final session name: "${finalSessionName}"`);

  // Create session with the proper session name
  const session = await createSession(
    databaseId,
    user.userId,
    finalSessionName,
  );

  // Update workflow ID
  await updateSession(
    databaseId,
    session.session_id,
    "workflow_id",
    workflowId,
  );
  session.activeWorkflowId = workflowId;

  // Store user context for execution
  session.metadata = session.metadata || {};
  session.metadata.userId = user.userId;
  // Remember the originating "workflow" todo so the run's Satisfied / Not
  // satisfied sign-off can set that todo's status (see feedbackHandler).
  if (todoId) {
    session.metadata.sourceTodoId = todoId;
    // Mark the todo in-progress while the run is live (resolved on sign-off).
    try {
      updateTodoStatus(databaseId, todoId, "in_progress");
      notifyClients("global", "todo_update");
    } catch (err) {
      console.error(
        `[startWorkflowChat] failed to mark todo ${todoId} in_progress:`,
        err,
      );
    }
  }
  await updateSession(
    databaseId,
    session.session_id,
    "metadata",
    session.metadata,
  );

  const sessionId = session.session_id;

  console.log(
    `[startWorkflowChat] Starting workflow ${workflowId} for session ${sessionId}`,
    `with session name: ${session.sessionName}`,
  );

  // Log workflow run
  logActivity(user.userEmail, "workflow_run", workflow.name, user.userId);

  // Execute workflow in background - pass session object to avoid race condition
  executeWorkflow(databaseId, workflowId, sessionId, "", session)
    .then(() => {
      console.log(`[startWorkflowChat] Workflow ${workflowId} completed!`);
      notifyClients(sessionId, "workflow_complete");
    })
    .catch((err) => {
      console.error(`[startWorkflowChat] Workflow error:`, err);
    });

  return c.html(
    <>
      {/* Marker for chatHelpers.js to update the URL without re-running the workflow on refresh */}
      <span
        id="chat-url-update"
        data-session-id={sessionId}
        data-url={shellChatUrl(
          activeShellId(user.userId),
          `session_id=${sessionId}&action=view`,
        )}
        hidden
      ></span>
      {await renderChatContent(user, session, workflowId, workflow.name, true)}
    </>,
  );
};

/**
 * View an existing session
 */
export const viewSessionChat = async (c: Context) => {
  const sessionId = c.req.query("session_id");
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId) {
    return c.html(await renderEmptyChatContent(user));
  }

  const session = await getSession(databaseId, sessionId);
  if (!session) {
    return c.html(
      <div class="p-6 rounded-lg bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800">
        <h2 class="font-semibold text-coral-600 dark:text-coral-300">
          Session Not Found
        </h2>
        <a
          href="/sessions"
          class="mt-4 inline-block text-brand-500 hover:underline"
        >
          ← View Sessions
        </a>
      </div>,
    );
  }

  const workflowId = session.activeWorkflowId;
  const prefill = c.req.query("prefill") || "";
  const todoId = c.req.query("todo_id") || "";
  return c.html(
    await renderChatContent(
      user,
      session,
      workflowId,
      session.sessionName,
      false,
      prefill,
      todoId,
    ),
  );
};

/**
 * Render the session content — header + messages.
 * SSE connection is on #chat-sse-container (parent page).
 */
export async function renderChatContent(
  user: User,
  session: any,
  workflowId?: string | null,
  workflowName?: string | null,
  _isRunning: boolean = false,
  prefill: string = "",
  todoId: string = "",
  transient: boolean = false,
) {
  const buttonClass =
    "rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-3 py-1.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors";
  const chatMode = user.currentChatMode || "build";

  const wsId = activeShellId(user.userId);
  const emailContext = await loadEmailContext(
    wsId,
    session.session_id,
    workflowId || session.workflow_id || session.activeWorkflowId || null,
  );

  const savedPrompts = user.currentDatabaseId ? listSavedPrompts(user.currentDatabaseId) : [];
  const dataItems = user.currentDatabaseId ? await listUserData(user.currentDatabaseId) : [];

  const hasContent = (session.messages ?? []).some(
    (m: any) => m.role === "user" && (m.markdown || "").trim(),
  ) || (Array.isArray((session.metadata as any)?.toolCalls) && (session.metadata as any).toolCalls.length > 0);

  return (
    <div class="max-w-6xl mx-auto px-4 md:px-6 pt-6 md:pt-8">
      <div class="flex items-start gap-6">
        <div class="flex-1 min-w-0">
      {/* Hidden input to track current session ID for SSE filtering */}
      <input type="hidden" id="current-session-id" value={session.session_id} />

      {/* Header — title + back button */}
      <div
        class="bg-white dark:bg-ink-800/50 border-b border-ink/[0.07] dark:border-white/[0.07] px-6 py-4 flex items-center justify-between rounded-t-xl shadow-sm"
        style="position: sticky; top: 0; z-index: 10;"
      >
        <h1 class="text-lg font-extrabold tracking-tight text-ink dark:text-white truncate">
          {workflowName || session.sessionName || "Chat Session"}
        </h1>
        <div class="flex items-center gap-2">
          {!workflowId && hasContent && (
            <button
              hx-post={`/sessions/save-as-workflow?session_id=${session.session_id}`}
              hx-target="#main-panel"
              hx-swap="innerHTML"
              class={buttonClass}
            >
              Save as workflow
            </button>
          )}
          <button
            hx-get="/app/session?action=new"
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-push-url={shellChatUrl(wsId, "action=new")}
            class={buttonClass}
          >
            New
          </button>
          <button
            hx-get={workflowId ? "/app/overview" : shellChatListUrl(wsId)}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            hx-push-url={workflowId ? "/app/overview" : shellChatListUrl(wsId)}
            class={buttonClass}
          >
            Back
          </button>
        </div>
      </div>

      {/* Inbound email — the trigger that started this run */}
      {emailContext.inbound.map((email: any) => (
        <div
          key={email.email_id}
          class="mt-4 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/30 px-4 py-3"
        >
          <div class="text-[11px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300 mb-1">
            Inbound email
          </div>
          <div class="text-sm font-semibold text-ink dark:text-white">
            {email.subject || "(no subject)"}
          </div>
          <div class="text-xs text-ink-500 mt-0.5">
            From {email.from_name || email.from_email || "unknown"}
            {email.date ? ` · ${new Date(email.date).toLocaleString()}` : ""}
          </div>
          <div class="text-sm text-ink-700 dark:text-white/80 mt-2 whitespace-pre-wrap">
            {email.entry?.textBody || stripHtml(email.entry?.htmlBody) || ""}
          </div>
          {email.audit_verdict === "failed" && (
            <div class="mt-2 text-xs text-coral-600 dark:text-coral-300 font-medium">
              Needs review — nothing was sent
              {email.fail_reason ? ` · ${email.fail_reason}` : ""}
            </div>
          )}
        </div>
      ))}

      {/* Messages - refreshes on SSE new_message event FROM BODY */}
      <div
        id="chat-messages"
        class="space-y-4 py-4"
        hx-get={`/sessions/api/messages?sessionId=${session.session_id}`}
        hx-trigger="load, sse:new_message from:closest [sse-connect], sse:workflow_complete from:closest [sse-connect]"
        hx-swap="innerHTML"
      >
        <div class="text-center py-8 text-ink-400 dark:text-ink-500">
          Loading messages...
        </div>
      </div>

      {/* Outbound email — what this run sent (or held) */}
      {emailContext.outbound.map((email: any) => (
        <div
          key={email.email_id}
          class="mb-4 rounded-xl border border-leaf-200 dark:border-leaf-800 bg-leaf-50/50 dark:bg-leaf-950/30 px-4 py-3"
        >
          <div class="text-[11px] font-semibold uppercase tracking-wider text-leaf-700 dark:text-leaf-300 mb-1">
            Outbound email
          </div>
          <div class="text-sm font-semibold text-ink dark:text-white">
            {email.subject || "(no subject)"}
          </div>
          <div class="text-xs text-ink-500 mt-0.5">
            To {email.to_email || "unknown"}
          </div>
          <div class="text-sm text-ink-700 dark:text-white/80 mt-2 whitespace-pre-wrap">
            {email.body_text || stripHtml(email.body_html) || ""}
          </div>
        </div>
      ))}

      {/* Composer input */}
      <Composer
        sessionId={session.session_id}
        workflowId={workflowId || ""}
        todoId={todoId}
        prefill={prefill}
      />
        </div>
        <div class="hidden lg:flex w-72 shrink-0 flex-col gap-4 sticky top-0">
          <Capabilities />
          <aside id="saved-prompts" class="min-h-0">
            <SavedPrompts prompts={savedPrompts} />
          </aside>
          <div
            id="data-refs"
            class="min-h-0"
            hx-get="/sessions/api/data-refs"
            hx-trigger="load"
            hx-swap="innerHTML"
          >
            <DataRefs items={dataItems} />
          </div>
        </div>
      </div>
    </div>
  );
}

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function loadEmailContext(
  wsId: string,
  sessionId: string,
  workflowId: string | null,
): Promise<{ inbound: any[]; outbound: any[] }> {
  if (!wsId) return { inbound: [], outbound: [] };
  let inbound: any[] = [];
  let outbound: any[] = [];
  try {
    const allInbound = await listEmails(wsId);
    inbound = allInbound.filter((e) => e.session_id === sessionId);

    const inboundIds = new Set(inbound.map((e) => e.email_id));
    if (workflowId || inboundIds.size > 0) {
      const allOutbound = await listSentEmails(wsId);
      outbound = allOutbound.filter(
        (e) =>
          (workflowId && e.workflow_id === workflowId) ||
          (e.in_reply_to && inboundIds.has(e.in_reply_to)),
      );
    }
  } catch (err) {
    console.error("[loadEmailContext] failed:", err);
  }
  return { inbound, outbound };
}

/**
 * Start a todo task — auto-submit the instruction and show running UI.
 * Called via HTMX on load when action=todo.
 */
export const todoStartChat = async (c: Context) => {
  const sessionId = c.req.query("session_id");
  const todoId = c.req.query("todo_id") || "";
  const instruction = c.req.query("prefill") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId || !instruction || !databaseId) {
    return c.html(
      <div class="p-6 text-coral-600">Missing session or instruction.</div>,
    );
  }

  const session = await getSession(databaseId, sessionId);
  if (!session) {
    return c.html(<div class="p-6 text-coral-600">Session not found.</div>);
  }

  // Add user message
  await addMessage({
    databaseId,
    session,
    role: "user",
    source: "user",
    html: `<div>${instruction.substring(0, 200)}${instruction.length > 200 ? "..." : ""}</div>`,
    markdown: instruction,
  });

  // Parse and route the command asynchronously
  const { parseCommand } =
    await import("@chat/index");
  const { command } = parseCommand(instruction);

  const ctx = {
    databaseId,
    userId: user.userId,
    sessionId,
    addMessage: async (msg: {
      markdown: string;
      html?: string;
      json?: Record<string, any>;
      knowledgeUsed?: Array<{
        name: string;
        scope: string;
        contentHash: string;
      }>;
    }) => {
      const sess = await getSession(databaseId, sessionId);
      if (sess) {
        await addMessage({
          databaseId,
          session: sess,
          role: "assistant",
          source: "build-agent",
          html: msg.html || "",
          markdown: msg.markdown,
          knowledgeUsed: msg.knowledgeUsed,
          json: msg.json,
        });
        notifyClients(sessionId, "new_message");
      }
    },
    addError: async (title: string, detail?: string) => {
      const sess = await getSession(databaseId, sessionId);
      if (sess) {
        const body = detail ? `<div class="text-sm mt-2">${detail}</div>` : "";
        const html = `<div class="bg-coral-50 dark:bg-coral-900/30 border border-coral-200 dark:border-coral-800 rounded-xl p-4"><div class="text-coral-600 dark:text-coral-300 font-semibold">${title}</div>${body}</div>`;
        await addMessage({
          databaseId,
          session: sess,
          role: "error",
          source: "build-agent",
          html,
          markdown: detail ? `**${title}**\n\n${detail}` : `**${title}**`,
        });
        notifyClients(sessionId, "new_message");
      }
    },
    setBusy: async () => {
      await updateSession(
        databaseId,
        sessionId,
        "instance_status",
        "in_progress",
      );
      notifyClients(sessionId, "new_message");
    },
    setDone: async () => {
      await updateSession(
        databaseId,
        sessionId,
        "instance_status",
        "awaiting_feedback",
      );
      notifyClients(sessionId, "workflow_complete");
    },
  };

  // Fire async — SSE will push updates
  (async () => {
    try {
      const { handleMessage } = await import("@chat/index");
      await handleMessage(databaseId, sessionId, user.userId, instruction, "", "build", user.chatVerbose !== false);
      // If the operation didn't call setDone (e.g. dataLoad), call it now
      const sess = await getSession(databaseId, sessionId);
      if (sess && sess.instance_status !== "awaiting_feedback") {
        await ctx.setDone();
      }
      // Plan rail shows remaining todos — no need for a chat message
    } catch (err: any) {
      console.error(`[todoStart] ${command || "auto"} FAILED:`, err.message);
      await ctx.addError("Todo failed", err.message || String(err));
      await ctx.setDone();
    }
  })();

  logActivity(
    (user as any).userEmail,
    `todo_${command || "auto"}`,
    instruction.substring(0, 200),
    user.userId,
  );

  // Return chat content with todo_id embedded
  return c.html(
    <>
      <span
        id="chat-url-update"
        data-session-id={sessionId}
        data-url={shellChatUrl(
          activeShellId(user.userId),
          `session_id=${sessionId}&action=view`,
        )}
        hidden
      ></span>
      {await renderChatContent(
        user,
        session,
        undefined,
        session.sessionName,
        false,
        "",
        todoId,
      )}
    </>,
  );
};

async function renderEmptyChatContent(_user: User) {
  return (
    <div class="flex flex-col min-h-[80vh]">
      <div class="flex-1 flex flex-col items-center justify-center">
        <div class="w-16 h-16 bg-brand-500/15 rounded-2xl flex items-center justify-center mb-4">
          <svg
            class="w-8 h-8 text-brand-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
            ></path>
          </svg>
        </div>
        <h2 class="text-xl font-extrabold tracking-tight text-ink dark:text-white mb-2">
          Load a workspace first
        </h2>
        <p class="text-ink-600 dark:text-white/70 mb-6">
          Import a .wfp file or create a new workspace to start chatting.
        </p>
        <a
          href="/app"
          class="rounded-xl px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors"
        >
          Back to App
        </a>
      </div>
    </div>
  );
}
