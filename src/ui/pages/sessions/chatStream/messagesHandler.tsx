import { Context } from "hono";
import { getSession, updateSession } from "@backend/core/session/sessions/session_all";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import type { User } from "@backend/types";
import { ApprovalActions } from "./ApprovalActions";
import { InteractiveForm } from "./InteractiveForm";
import { InlineAudit } from "./InlineAudit";

/**
 * Get messages for a session
 * Called via HTMX when SSE sends new_message event
 */
export const messagesHandler = async (c: Context) => {
  const sessionId = c.req.query("sessionId") || "";
  const transient = c.req.query("transient") === "1";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId) {
    return c.html(
      <div class="text-center py-8 ds-text-muted">No session selected</div>,
    );
  }

  const session = await getSession(databaseId, sessionId);
  if (!session) {
    return c.html(
      <div class="text-center py-8 text-coral-400">Session not found</div>,
    );
  }

  if (!session.messages || session.messages.length === 0) {
    return c.html(
      <div class="text-center py-8 ds-text-muted">No messages yet</div>,
    );
  }

  // Build label lookups from workflow nodes so messages without nodeLabel can resolve a name
  const nodeById: Record<string, string> = {};
  const labelByToolId: Record<string, string> = {};

  if (session.workflows) {
    for (const [wfId, wf] of Object.entries(session.workflows) as [string, any][]) {
      for (const node of wf.nodes || []) {
        if (node.id && node.label) nodeById[node.id] = node.label;
        if (node.tool_id && node.label && !labelByToolId[node.tool_id])
          labelByToolId[node.tool_id] = node.label;
      }
    }
  }

  const resolveLabel = (message: any): string => {
    if (message.nodeLabel) return message.nodeLabel;
    if (message.nodeId && nodeById[message.nodeId]) return nodeById[message.nodeId];
    if (message.source && labelByToolId[message.source]) return labelByToolId[message.source];
    return message.role;
  };

  const isProcessing = session.instance_status === "pending" || session.instance_status === "in_progress";

  // Find the last message with a pending plan (only show buttons on the latest one)
  const lastPlanMsgId = [...session.messages].reverse().find((m: any) => m.json?.pendingPlan)?.id;
  // Find the last /scope intake question (show the "skip" escape only on it)
  const lastScopingMsgId = [...session.messages].reverse().find((m: any) => m.json?.scoping)?.id;
  // Last message overall — write-approval buttons only render on it (so they
  // disappear once the action has run and newer messages have been appended).
  const lastMessageId = session.messages[session.messages.length - 1]?.id;

  // Build auditId → post-mortem HTML lookup
  const postMortems: Record<string, string> = {};
  for (const m of session.messages as any[]) {
    if (m?.json?.postMortem && m.json.auditId) {
      postMortems[String(m.json.auditId)] = m.html || "";
    }
  }

  const classifyKind = (message: any): string => {
    if (message.role === "user") return "user";
    if (message.role === "error") return "error";
    if (message.role === "form") return "form";
    if (message.role === "form-submitted") return "form-submitted";
    if (message.json?.kind) return message.json.kind;
    if (message.json?.tool) return "tool-call";
    if (message.source === "system" || message.json?.system) return "system";
    return "reply";
  };

  const NOISE_KINDS = new Set(["llm-call", "jev-call", "tool-call", "meta", "status", "system"]);

  // Split messages into visible content and collapsible process details. The
  // details are always rendered (grouped under a <details> toggle) rather than
  // filtered out, so the user can expand them with pure CSS — no server toggle.
  const isNoise = (m: any): boolean => NOISE_KINDS.has(classifyKind(m));
  const allMsgs = session.messages.filter((m: any) => !m?.json?.postMortem);
  const contentMsgs = allMsgs.filter((m: any) => {
    if (isNoise(m)) return false;
    const k = classifyKind(m);
    // step-status / step markers fold into the live plan checklist below.
    if (k === "step-status" || k === "step") return false;
    if (transient && (m.role === "system" || m.source === "workflow_start" || m.source === "workflow_end")) return false;
    return true;
  });
  const noiseMsgs = allMsgs.filter(isNoise);

  // Live plan checklist — the latest `plan` message plus the step-statuses
  // emitted after it (each index overwrites with the most recent status).
  const planMeta = (() => {
    let planIdx = -1;
    for (let i = allMsgs.length - 1; i >= 0; i--) {
      if (allMsgs[i].json?.kind === "plan") { planIdx = i; break; }
    }
    if (planIdx < 0) return null;
    const statusByIndex: Record<number, string> = {};
    for (let i = planIdx + 1; i < allMsgs.length; i++) {
      const j = allMsgs[i].json as any;
      if (j?.kind === "step-status" && Number.isInteger(j.index)) {
        statusByIndex[j.index] = j.status;
      }
    }
    return { plan: allMsgs[planIdx], statusByIndex };
  })();

  const planChecklist = (steps: any[], statusByIndex: Record<number, string>) => {
    const iconFor = (status?: string) => {
      if (status === "done") return <span class="text-leaf-500">✓</span>;
      if (status === "running") return <span class="text-brand-500">▶</span>;
      if (status === "error") return <span class="text-coral-400">✗</span>;
      return <span class="text-ink-300 dark:text-ink-600">○</span>;
    };
    return (
      <div class="px-1 py-1">
        <div class="text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-2">Plan</div>
        <ol class="space-y-1">
          {steps.map((s: any, i: number) => (
            <li class="flex items-start gap-2 text-sm text-ink-600 dark:text-white/80">
              <span class="w-4 text-center font-semibold shrink-0">{iconFor(statusByIndex[i])}</span>
              <span class={statusByIndex[i] === "error" ? "text-coral-600 dark:text-coral-400 font-medium" : ""}>{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  };

  const stripMd = (s: string): string =>
    (s || "")
      .replace(/^\s*>\s*/gm, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/^[_*]\s*|\s*[_*]$/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const kindIcon = (kind: string) => {
    if (kind === "llm-call" || kind === "jev-call") {
      return (
        <svg class="w-3.5 h-3.5 text-brand-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      );
    }
    if (kind === "tool-call") {
      return (
        <svg class="w-3.5 h-3.5 text-ink-400 dark:text-ink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      );
    }
    if (kind === "meta") {
      return (
        <svg class="w-3.5 h-3.5 text-leaf-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
    }
    return (
      <svg class="w-3.5 h-3.5 text-ink-400 dark:text-ink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l2 2" />
      </svg>
    );
  };

  return c.html(
    <div class="space-y-3">
      {contentMsgs.map((message: any, index: number) => {
        const kind = classifyKind(message);
        const isError = kind === "error";
        const auditJson = message?.json?.successFactorAudit as any;
        const isAuditFailed = auditJson?.verdict === "failed";

        const isAssistantReply = resolveLabel(message) === "assistant";
        const cardClass = kind === "user"
          ? "ds-card rounded-r-lg border-l-4 border-brand-500 bg-brand-50/40 dark:bg-brand-950/30 px-3 py-2"
          : `ds-card rounded-lg border px-3 py-2 ${isError ? "border-coral-200 dark:border-coral-800" : "border-ink/[0.08] dark:border-white/[0.08]"} ${isAuditFailed ? "!border-coral-500 !ring-1 !ring-coral-200" : ""}`;

        if (kind === "plan") {
          const steps = Array.isArray(message.json?.steps) ? message.json.steps : null;
          if (planMeta && message.id === planMeta.plan.id && steps) {
            return planChecklist(steps, planMeta.statusByIndex);
          }
          return (
            <div class="px-1 py-1 text-sm text-ink-600 dark:text-white/80">
              <div
                class="prose prose-sm prose-slate dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: message.html || message.markdown || "" }}
              />
            </div>
          );
        }

        return (
        <div class={cardClass}>
          {!transient && (<div class="flex items-center gap-2 mb-2">
            {kind === "user" ? (
              <span class="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">You</span>
            ) : isAssistantReply && Array.isArray(message.json?.skills) && message.json.skills.length > 0 ? (
              <span class="flex items-center gap-1.5 flex-wrap">
                {message.json.skills.map((s: string) => (
                  <span class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-1.5 py-0.5 rounded">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    {s}
                  </span>
                ))}
              </span>
            ) : isAssistantReply ? (
              <span class="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                <svg class="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Workflow
              </span>
            ) : (
              <span class="ds-label">{resolveLabel(message)}</span>
            )}
            <span class="ds-label-muted ml-auto">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </div>)}

          {/* Message content */}
          {message.role === "form" ? (
            /* Interactive Form - Universal form system */
            <InteractiveForm message={message as any} sessionId={sessionId} />
          ) : message.role === "form-submitted" ? (
            /* Submitted form — show compact completed state */
            <div class="text-sm text-ink-500 italic">
              ✓ Submitted
            </div>
          ) : auditJson ? (
            /* Machine audit verdict — rendered inline */
            <InlineAudit
              audit={auditJson}
              sessionId={sessionId}
              postMortemHtml={postMortems[auditJson.auditId]}
            />
          ) : (
            /* Regular message */
            <div
              class="prose prose-sm prose-slate dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{
                __html: message.html || message.markdown || "",
              }}
            />
          )}

          {/* Build plan approval buttons — only on the latest plan, and only when idle */}
          {message.json?.pendingPlan && message.id === lastPlanMsgId && !isProcessing && session.instance_status === "awaiting_feedback" && (
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-ink/[0.07] dark:border-white/[0.07]">
              {(() => {
                const plan = message.json?.pendingPlan || {};
                return <button
                  hx-post="/sessions/api/build-send"
                  hx-vals={JSON.stringify({ session_id: sessionId, workflow_id: session.activeWorkflowId || "", message: "", action: "__approve__" })}
                  hx-swap="none"
                  class="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-md transition-colors"
                >
                  Add to Plan
                </button>;
              })()}
              <button
                hx-post="/sessions/api/build-send"
                hx-vals={JSON.stringify({ session_id: sessionId, workflow_id: session.activeWorkflowId || "", message: "", action: "__cancel__" })}
                hx-swap="none"
                class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <span class="text-xs text-ink-400 dark:text-ink-500 ml-2">Or type changes in the chat</span>
            </div>
          )}

          {/* Intake "skip" escape — proceed with the assistant's assumptions */}
          {message.json?.scoping && message.id === lastScopingMsgId && !isProcessing && session.instance_status === "awaiting_feedback" && (
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-ink/[0.07] dark:border-white/[0.07]">
              <button
                hx-post="/sessions/api/build-send"
                hx-vals={JSON.stringify({ session_id: sessionId, workflow_id: session.activeWorkflowId || "", message: "go — proceed with your best assumptions" })}
                hx-swap="none"
                class="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-md transition-colors"
              >
                Skip questions — build the plan
              </button>
              <span class="text-xs text-ink-400 dark:text-ink-500 ml-2">Or answer in the chat</span>
            </div>
          )}

          {/* Write-approval buttons — only on the latest message, when idle */}
          {message.json?.approval && message.id === lastMessageId && !isProcessing && session.instance_status === "awaiting_feedback" && (
            <div class="flex items-center gap-2 mt-4 pt-3 border-t border-ink/[0.07] dark:border-white/[0.07]">
              <button
                hx-post="/sessions/api/build-send"
                hx-vals={JSON.stringify({ session_id: sessionId, workflow_id: session.activeWorkflowId || "", message: "approve", action: "" })}
                hx-swap="none"
                class="px-4 py-2 text-sm font-medium text-white bg-brand-500 hover:bg-brand-600 rounded-md transition-colors"
              >
                Approve
              </button>
              <button
                hx-post="/sessions/api/build-send"
                hx-vals={JSON.stringify({ session_id: sessionId, workflow_id: session.activeWorkflowId || "", message: "", action: "__cancel__" })}
                hx-swap="none"
                class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Approval actions for workflow-approval messages */}
          {message.source === "workflow-approval" && message.json?.token && (
            <ApprovalActions
              token={message.json.token}
              stepName={message.json.step}
              approverEmail={message.json.approver_email}
              userEmail={user.userEmail}
              isAdmin={user.isAdmin}
              sessionId={message.json.session_id}
            />
          )}

          {/* Copy JSON button for messages with json data */}

          {/* Always show Copy JSON for tool messages */}
        </div>
      );
    })}

      {/* Process details — collapsed by default; expand to inspect LLM/Jev/tool steps */}
      {noiseMsgs.length > 0 && (
        <details class="group mt-2">
          <summary class="cursor-pointer select-none text-xs font-semibold text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-ink-300">
            Process details ({noiseMsgs.length})
          </summary>
          <div class="mt-2 space-y-0.5 border-l-2 border-ink/[0.08] dark:border-white/[0.08] pl-3">
            {noiseMsgs.map((message: any, i: number) => {
              const kind = classifyKind(message);
              if (kind === "system") {
                return (
                  <div class="flex items-center gap-3 text-[11px] text-ink-400 dark:text-ink-500 py-1">
                    <span class="truncate">{stripMd(message.markdown || "") || stripMd(message.html || "")}</span>
                  </div>
                );
              }
              const text =
                kind === "tool-call"
                  ? `${message.json?.tool || ""}${message.json?.iteration != null ? ` \u00b7 iter ${message.json.iteration}` : ""}`
                  : stripMd(message.markdown || "") || stripMd(message.html || "");
              return (
                <div class="flex items-start gap-2 text-xs text-ink-400 dark:text-ink-500 py-0.5">
                  <span class="mt-px shrink-0">{kindIcon(kind)}</span>
                  <span class="min-w-0 truncate">
                    {kind === "llm-call" || kind === "jev-call" ? (
                      <span dangerouslySetInnerHTML={{ __html: message.html || message.markdown || "" }} />
                    ) : (
                      text
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Processing spinner + cancel — shown when session has an active pipeline */}
      {isProcessing && (
        <div class="flex items-center gap-3 py-3 px-4">
          <div class="animate-spin rounded-full h-5 w-5 border-2 border-brand-500 border-t-transparent"></div>
          <span class="text-sm text-ink-500">Working...</span>
          <button
            hx-post={`/sessions/api/feedback?session_id=${sessionId}&status=cancelled`}
            hx-swap="none"
            class="ml-auto px-3 py-1 text-xs font-medium text-ink-500 border border-ink/[0.1] dark:border-white/[0.1] hover:border-coral-300 hover:text-coral-600 dark:hover:text-coral-400 rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Cancelled state */}
      {session.instance_status === "cancelled" && (
        <div class="flex items-center gap-2 py-3 px-4 border-t border-ink/[0.07] dark:border-white/[0.07]">
          <span class="text-sm text-ink-500">Cancelled</span>
        </div>
      )}
    </div>,
  );
};

/**
 * Handle feedback button clicks (Satisfied, Not Satisfied, Cancel)
 * Sets instance_status on session and re-renders messages
 */
export const feedbackHandler = async (c: Context) => {
  const sessionId = c.req.query("session_id") || "";
  const status = c.req.query("status") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId || !status) {
    return c.html(<div class="text-coral-600">Missing parameters</div>);
  }

  const validStatuses = ["satisfied", "not_satisfied", "cancelled"];
  if (!validStatuses.includes(status)) {
    return c.html(<div class="text-coral-600">Invalid status</div>);
  }

  await updateSession(databaseId, sessionId, "instance_status", status);

  // If cancelling, signal the build pipeline to abort at the next checkpoint
  if (status === "cancelled") {
    const { cancelBuild } = await import("@backend/core/process_manager/build-pipeline");
    cancelBuild(databaseId);
  }

  // If this run was launched from a "workflow" todo, the sign-off drives that
  // todo's status: Satisfied → done, Not satisfied → reopened (back to pending).
  // (Cancelled leaves the todo untouched.)
  if (status === "satisfied" || status === "not_satisfied") {
    const session = await getSession(databaseId, sessionId);
    const sourceTodoId = (session?.metadata as any)?.sourceTodoId as string | undefined;
    if (sourceTodoId) {
      try {
        const { updateTodoStatus } = await import("@backend/core/workspace/todoStore");
        updateTodoStatus(databaseId, sourceTodoId, status === "satisfied" ? "done" : "pending");
        notifyClients("global", "todo_update");
      } catch (err) {
        console.error(`[feedback] failed to update source todo ${sourceTodoId}:`, err);
      }
    }
  }

  // Fire new_message so #chat-messages re-renders (it listens for sse:new_message)
  notifyClients(sessionId, "new_message");
  notifyClients(sessionId, "workflow_complete");

  return c.text("");
};
