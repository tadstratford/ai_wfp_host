// Host adapter for the canonical WFP_API surface (M12).
//
// This module implements the wfp-api 1.1.0 `WFP_API` interface using host
// primitives: WorkspaceSession for data/knowledge/sessions, host's Session
// object for runtime parameters/messages, the provider layer for LLM, and the
// PauseSignal pattern for pauseForInput.
//
// Tools see the canonical Tier 1 + Tier 2 surface — same as in spa/voice
// runners — so a .wfp file that works in the SPA runners now works here.
//
// Dropped from the legacy host API (M9/M13): llm.classify, llm.summarize,
// query, getDatabase, utils.parseExcel, runWorkflow. Custom tools that
// depended on those will fail with `is not a function` — the .wfp builder
// prompt no longer suggests them.

import { createHash, randomUUID } from "node:crypto";
import { autoWrap, isEnvelope, wfpFetch } from "wfp-api";
import type {
  AddMessageInput,
  ChatTurn,
  MetaData,
  PausePrompt,
  PauseResult,
  ReportContext,
  TypedEnvelope,
  WFP_API,
} from "wfp-api";
import type { FormField, TodoEntry } from "wfp-format";
import type {
  Session as HostSession,
  Message as HostMessage,
} from "@backend/types";
import {
  getParameterValue,
  getParameterMetaValue,
  setParameterValue,
} from "@backend/core/settings/parameterHelpers";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";
import {
  getSessionByDatabaseId,
  requireSessionByDatabaseId,
} from "@backend/core/workspace/workspaceSessionStore";
import { userManager } from "@backend/core/admin/userManager";
import {
  addTodo as addTodoToStore,
  deleteTodo,
  type WorkspaceTodo,
} from "@backend/core/workspace/todoStore";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { PauseSignal } from "./PauseSignal";
import { render as renderTemplate } from "@ui/templates/index";
import { buildReportMessage } from "@core/tools/reportRenderer";
import {
  listEmails,
  getEmail,
  updateEmailStatus,
  deleteEmail,
  sendWorkspaceEmail,
  listAttachments as listEmailAttachments,
  getAttachmentById as getEmailAttachment,
  decodeAttachmentText,
} from "@backend/core/workspace/emailInbox";
import { loadAllSkills } from "@core/skills/loader";
import { loadRules } from "@rules/loader";
import { getClassifierKey } from "@backend/core/user/getLLMApiKey";
import { saveDataEntry } from "@data";
import { aggregator } from "@mcp/aggregator";
import { isMcpToolAllowed } from "@mcp/policy";
import { setMcpServerScope } from "@mcp/scope";

// ── Voice → markdown promotion (M12 (a)) ───────────────────────────────────

function promoteVoiceToMarkdown(msg: AddMessageInput): AddMessageInput {
  if (msg.voice && !msg.markdown && !msg.html) {
    return { ...msg, markdown: msg.voice };
  }
  return msg;
}

// ── Run provenance ──────────────────────────────────────────────────────────
//
// Reports must state whether their data was produced deterministically or with
// AI assistance, and this gets baked into the self-contained report HTML at
// generation time. Workflow runs are deterministic; the classifier
// (`judge_data`) produces typed verdicts without a free-text LLM step. The
// provenance mark is retained for future AI-assisted steps.

interface RunProvenance {
  usedLLM: boolean;
  model: string | null;
}

function readRunProvenance(hostSession: HostSession): RunProvenance {
  const meta = (hostSession.metadata ?? {}) as Record<string, unknown>;
  return (
    (meta.runProvenance as RunProvenance | undefined) ?? {
      usedLLM: false,
      model: null,
    }
  );
}

function sha256Short(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// Host todo (todoStore shape) → canonical spec TodoEntry. Host status
// `skipped` maps to spec `cancelled`.
function hostTodoToSpec(t: WorkspaceTodo): TodoEntry {
  return {
    id: t.todoId,
    label: t.label,
    instruction: t.instruction,
    status: t.status === "skipped" ? "cancelled" : (t.status as TodoEntry["status"]),
    type: t.type,
    ...(t.workflowId ? { workflow_id: t.workflowId } : {}),
    ...(t.instanceName ? { instance_name: t.instanceName } : {}),
    ...(t.creatingWorkflow ? { creating_workflow: t.creatingWorkflow } : {}),
    ...(t.tag ? { tag: t.tag } : {}),
    ...(t.dueDate ? { due_date: t.dueDate } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.hours ? { hours: t.hours } : {}),
    sort_order: t.sortOrder,
    source: "user" as const,
    category: t.category,
    created_at: t.createdAt,
  };
}

// ── MCP bridge (api.callMcp / api.mcp) ─────────────────────────────────────
// Custom tool code calls MCP tools inline so a chat-built tool is fully
// self-contained and re-runnable. The host re-scopes the target server from
// the run's databaseId at call time (no reliance on the chat orchestrator's
// ambient scope) and enforces the read-only tool policy.

async function callMcpTool(
  databaseId: string,
  server: string,
  tool: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  if (!isMcpToolAllowed(tool)) {
    throw new Error(
      `api.mcp: "${tool}" is not callable from custom tool code (read-only policy). ` +
        `Use it from chat instead.`,
    );
  }
  setMcpServerScope(server, databaseId);
  const result = await aggregator.callTool(tool, args ?? {});
  const contentArray = (result as { content?: unknown[] } | undefined)?.content;
  const text = (Array.isArray(contentArray) ? contentArray : [])
    .filter((c) => (c as { type?: string })?.type === "text")
    .map((c) => (c as { text?: string }).text ?? "")
    .join("\n");
  if (!text) return contentArray ?? null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── Build the API ──────────────────────────────────────────────────────────

/**
 * Construct the WFP_API for a single tool invocation.
 *
 * Signature kept stable for the executor: `(session, databaseId, toolId)`.
 * `nodeLabel` is derived from `session.metadata.currentNode`.
 */
export function createWFP_API(
  hostSession: HostSession,
  databaseId: string,
  toolId: string,
): WFP_API {
  const nodeLabel = (hostSession.metadata as any)?.currentNode?.label ?? "";

  // ── Parameters (host's array-shaped SessionParameter list) ──────────────
  const getParameter = (name: string): unknown =>
    getParameterValue(hostSession.parameters, name, databaseId);

  const getParameterMeta = (name: string): MetaData | undefined =>
    getParameterMetaValue(hostSession.parameters, name, databaseId) as
      | MetaData
      | undefined;

  const setParameter = (name: string, value: unknown): void => {
    const envelope = isEnvelope(value) ? value : autoWrap(value);
    hostSession.parameters = setParameterValue(
      hostSession.parameters,
      name,
      envelope,
    );
  };

  // ── setData — persist into the workspace's `data` map immediately ───────
  const setData = async (name: string, value: unknown): Promise<void> => {
    const envelope = isEnvelope(value) ? value : autoWrap(value);

    // Persist via the shared user-data path (sanitize → setDataEntry →
    // buildAutoMask) so workflow-produced data is masked consistently with
    // uploaded and chat-produced data.
    const { name: safeName } = saveDataEntry(databaseId, name, envelope);

    // Also expose immediately to downstream nodes in this run.
    hostSession.parameters = setParameterValue(
      hostSession.parameters,
      safeName,
      envelope,
    );
  };

  // ── addMessage — push to host session, voice → markdown promotion ───────
  const addMessage = (rawMsg: AddMessageInput): void => {
    const msg = promoteVoiceToMarkdown(rawMsg);
    const nodeContext = (hostSession.metadata as any)?.currentNode;
    const messageId = rawMsg.id ?? Date.now().toString();

    let resolvedHtml: string =
      msg.html && msg.html.length > 0
        ? msg.html
        : msg.markdown && msg.markdown.length > 0
          ? markdownToHtml(msg.markdown, msg.role)
          : "";

    // If template + data are provided, render the template immediately
    if (!resolvedHtml && msg.template) {
      try {
        resolvedHtml = renderTemplate(msg.template, msg.data, {
          databaseId,
          sessionId: hostSession.session_id,
          messageId,
        });
      } catch (e: any) {
        resolvedHtml = `<div class="text-sm text-red-500">Template "${msg.template}" failed: ${e.message}</div>`;
      }
    }

    const hostMsg: Partial<HostMessage> = {
      id: messageId,
      source: toolId,
      timestamp: new Date(),
      nodeId: nodeContext?.id,
      nodeLabel: nodeContext?.label ?? nodeLabel,
      role: msg.role ?? "tool",
      markdown: msg.markdown,
      html: resolvedHtml,
      table: msg.table,
      chart: msg.chart,
      form: msg.form,
      json: msg.json,
      template: msg.template,
      template_data: msg.data,
      ...((rawMsg as any).element ? { element: (rawMsg as any).element } : {}),
    };
    hostSession.messages.push(hostMsg as HostMessage);
  };

  // ── Chat history via WorkspaceSession ──────────────────────────────────
  const getChatHistory = (limit?: number): ChatTurn[] => {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return [];
    const workflowId = hostSession.activeWorkflowId;
    if (!workflowId) return [];
    const chat = ws
      .getSessions()
      .find((s) => s.kind === "chat" && s.workflow_id === workflowId);
    if (!chat?.messages) return [];
    const turns: ChatTurn[] = chat.messages.map((m: any) => ({
      turn_id: m.id ?? randomUUID(),
      workflow_id: workflowId,
      role:
        m.role === "user" || m.role === "assistant" || m.role === "system"
          ? m.role
          : "assistant",
      content: m.markdown ?? "",
      timestamp:
        typeof m.timestamp === "string"
          ? m.timestamp
          : new Date().toISOString(),
    }));
    if (limit && limit > 0) return turns.slice(-limit);
    return turns;
  };

  // ── Full run stream (for the terminal audit) ───────────────────────────
  const getStream = (): string => {
    const messages = hostSession.messages ?? [];
    const parts: string[] = [];
    for (const m of messages) {
      const role = m.role ?? "tool";
      const chunks: string[] = [];
      if (m.markdown) chunks.push(String(m.markdown));
      if (m.json) chunks.push(JSON.stringify(m.json));
      if (m.table) chunks.push(JSON.stringify(m.table));
      if (m.html) chunks.push(String(m.html).replace(/<[^>]*>/g, " "));
      if (chunks.length) parts.push(`[${role}] ${chunks.join("\n")}`);
    }
    return parts.join("\n\n");
  };

  const appendChat = (turn: {
    role: "user" | "assistant" | "system";
    content: string;
  }): void => {
    const ws = requireSessionByDatabaseId(databaseId);
    const workflowId = hostSession.activeWorkflowId;
    if (!workflowId)
      throw new Error("appendChat: no active workflow in this session");

    const sessions = ws.getSessions();
    let chat = sessions.find(
      (s) => s.kind === "chat" && s.workflow_id === workflowId,
    );
    if (!chat) {
      const now = new Date().toISOString();
      chat = {
        id: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: "Chat",
        workflow_id: workflowId,
        kind: "chat",
        status: "in_progress",
        messages: [],
        created_at: now,
        updated_at: now,
      };
    }
    const messages = chat.messages ?? [];
    messages.push({
      id: `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      role: turn.role,
      timestamp: new Date().toISOString(),
      markdown: String(turn.content ?? ""),
    });
    chat.messages = messages;
    chat.updated_at = new Date().toISOString();
    ws.upsertSession(chat);
  };

  // ── Report context — canonical workspace + run provenance + identities ──
  const getReportContext = async (): Promise<ReportContext> => {
    const ws = requireSessionByDatabaseId(databaseId);
    const meta = ws.getMetadata();

    const workflowId = hostSession.activeWorkflowId ?? null;
    const wf = workflowId ? ws.getWorkflow(workflowId) : null;

    const dataFiles = ws.getDataNames().map((name) => {
      const entry = ws.getDataEntry(name);
      const content = typeof entry?.content === "string" ? entry.content : "";
      return {
        name: entry?.source_filename || name,
        rowCount: entry?.row_count ?? null,
        contentHash: sha256Short(content),
      };
    });

    // Resolve run-by (the session's user) and workspace owner (the session's
    // workspace user) emails — both need an admin lookup, hence async.
    let runByEmail: string | null = null;
    const runnerId = hostSession.user_id;
    if (runnerId) {
      const runner = await userManager.getUser(runnerId);
      runByEmail = runner?.userEmail ?? null;
    }
    let ownerEmail: string | null = null;
    if (ws.userId) {
      ownerEmail =
        ws.userId === runnerId
          ? runByEmail
          : ((await userManager.getUser(ws.userId))?.userEmail ?? null);
    }

    const prov = readRunProvenance(hostSession);
    return {
      workspace: meta.workspace ?? "Workspace",
      period: meta.period ?? null,
      generatedAt: new Date().toISOString(),
      workflowName: wf?.name ?? "",
      workflowId,
      dataFiles,
      provenance: prov.usedLLM ? "ai-assisted" : "deterministic",
      llmModel: prov.usedLLM ? prov.model : null,
      runByEmail,
      ownerEmail,
    };
  };

  // ── Knowledge from the active workspace ────────────────────────────────
  const getKnowledge = (name: string): string | null => {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return null;
    const content = ws.getKnowledgePack(name)?.content;
    return typeof content === "string" ? content : null;
  };

  // ── Skills (app-level, scoped to the database's enabled groups) ───────
  const getSkill = (name: string): string | null => {
    return loadAllSkills(undefined, databaseId).find((s) => s.name === name)?.content ?? null;
  };
  const listSkills = (): { name: string; description?: string }[] => {
    return loadAllSkills(undefined, databaseId).map((s) => ({
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
    }));
  };

  // ── Rules from the active workspace ───────────────────────────────────
  const getRule = (name: string): string | null => {
    return loadRules(databaseId).find((r) => r.name === name)?.content ?? null;
  };
  const listRules = (): { name: string; description?: string }[] => {
    return loadRules(databaseId).map((r) => ({
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
    }));
  };
  const getRules = (): { name: string; description?: string; content: string }[] => {
    return loadRules(databaseId).map((r) => ({
      name: r.name,
      ...(r.description ? { description: r.description } : {}),
      content: r.content,
    }));
  };

  // ── Workflow (the one this session is running) ────────────────────────
  const getActiveWorkflow = (): { id: string; name: string; description: string } | null => {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return null;
    const workflowId = hostSession.activeWorkflowId;
    if (!workflowId) return null;
    const wf = ws.getWorkflow(workflowId);
    if (!wf) return null;
    return { id: wf.id, name: wf.name, description: wf.description ?? "" };
  };

  // ── pauseForInput — host's node-boundary pause (throws PauseSignal) ────
  const pauseForInput = async (prompt: PausePrompt): Promise<PauseResult> => {
    // Validate the form against the FormField contract BEFORE touching session
    // state or rendering. A type violation throws a precise, actionable error
    // (caught by the build's tool test → drives the retry loop to self-correct)
    // rather than crashing the renderer with an opaque "str.replace" error.
    validatePauseForm(prompt);

    const pauseId = randomUUID();
    hostSession.waitingForInput = true;

    // Render the HTMX form and push it into the chat. Capture the resulting
    // message's id so resume can replace this exact message with a
    // "submitted" placeholder (prevents the form from re-appearing when the
    // chat panel re-renders from the DB).
    const formHtml = renderPauseFormHtml(
      hostSession.session_id,
      pauseId,
      prompt,
    );
    const messageId = `pause-${pauseId}`;
    const nodeContext = (hostSession.metadata as any)?.currentNode;
    hostSession.messages.push({
      id: messageId,
      source: toolId,
      timestamp: new Date(),
      nodeId: nodeContext?.id,
      nodeLabel: nodeContext?.label ?? nodeLabel,
      role: "system",
      html: formHtml,
    } as HostMessage);

    (hostSession.metadata as any) = {
      ...(hostSession.metadata ?? {}),
      pause: {
        pauseId,
        prompt,
        nodeId: nodeContext?.id ?? null,
        messageId,
      },
    };

    // Throw out of the tool — the executor catches this signal.
    throw new PauseSignal(prompt, pauseId);
  };

  // ── Compose the API ────────────────────────────────────────────────────
  const api: WFP_API = {
    getParameter,
    getParameterMeta,
    setParameter,
    setData,
    addMessage,
    fetch: (url, options) => wfpFetch(url, options),
    callMcp: (server, tool, args) => callMcpTool(databaseId, server, tool, args),
    mcp: new Proxy(
      {},
      {
        get: (_target, server: string) =>
          new Proxy(
            {},
            {
              get: (_t2, tool: string) => {
                if (typeof tool !== "string") return undefined;
                return (args?: Record<string, unknown>) =>
                  callMcpTool(databaseId, server, tool, args);
              },
            },
          ),
      },
    ),
    getKnowledge,
    getSkill,
    listSkills,
    getRule,
    listRules,
    getRules,
    getActiveWorkflow,
    getClassifierKey: async () => {
      const ws = getSessionByDatabaseId(databaseId);
      if (!ws?.userId) return null;
      try {
        return await getClassifierKey(ws.userId);
      } catch {
        return null;
      }
    },
    getChatHistory,
    getStream,
    appendChat,
    pauseForInput,
    renderReport(html: string, filename: string): void {
      const messageId = Date.now().toString();
      const { html: reportHtml, json } = buildReportMessage(
        html,
        filename,
        hostSession.session_id,
        undefined,
        messageId,
      );
      addMessage({ id: messageId, html: reportHtml, json });
    },
    renderWidget(name: string, data: unknown, filename?: string): void {
      const messageId = Date.now().toString();
      const html = renderTemplate(name, data, {
        databaseId,
        sessionId: hostSession.session_id,
        messageId,
      });
      const { html: reportHtml, json } = buildReportMessage(
        html,
        filename ?? `${name}.html`,
        hostSession.session_id,
        undefined,
        messageId,
      );
      addMessage({ id: messageId, html: reportHtml, json });
    },
    todos: {
      list(filter) {
        const all = requireSessionByDatabaseId(databaseId).getTodos();
        return filter?.status
          ? all.filter((t) => t.status === filter.status)
          : all;
      },
      add(todo) {
        const instanceName =
          todo.instanceName ??
          (getParameter("todo_wf_instance_name") as string | undefined) ??
          "";
        let creatingWorkflow = "";
        try {
          const wfId = hostSession.activeWorkflowId;
          if (wfId)
            creatingWorkflow =
              requireSessionByDatabaseId(databaseId).getWorkflow(wfId)?.name ??
              "";
        } catch {
          /* best-effort */
        }

        const created = addTodoToStore(databaseId, {
          label: todo.label,
          instruction: todo.instruction ?? "",
          type: todo.type ?? "manual",
          workflowId: todo.workflowId,
          instanceName,
          creatingWorkflow,
          tag: todo.tag,
          dueDate: todo.dueDate,
          notes: todo.notes,
          hours: todo.hours,
          source: todo.source ?? "user",
          category: todo.category ?? "general",
        });
        notifyClients("global", "todo_update");
        return hostTodoToSpec(created);
      },
      update(id, patch) {
        const ws = requireSessionByDatabaseId(databaseId);
        const todoList = ws.getTodos();
        const t = todoList.find((x) => x.id === id);
        if (!t) return false;
        if (patch.status !== undefined) t.status = patch.status;
        if (patch.label !== undefined) t.label = patch.label;
        t.updated_at = new Date().toISOString();
        ws.setTodos(todoList);
        notifyClients("global", "todo_update");
        return true;
      },
      complete(id) {
        return api.todos.update(id, { status: "done" });
      },
      remove(id) {
        const ok = deleteTodo(databaseId, id);
        if (ok) notifyClients("global", "todo_update");
        return ok;
      },
    },
    workflows: {
      list() {
        return requireSessionByDatabaseId(databaseId)
          .getWorkflows()
          .map((w) => ({
            id: w.id,
            name: w.name,
            description: firstMeaningfulLine(w.description),
          }));
      },
    },
    emails: {
      async list(filter) {
        const workspaceId = requireSessionByDatabaseId(databaseId).workspaceId;
        let emails = await listEmails(workspaceId);
        if (filter?.status) emails = emails.filter((e) => e.status === filter.status);
        if (filter?.limit && filter.limit > 0) emails = emails.slice(0, filter.limit);
        return emails;
      },
      async get(emailId) {
        const workspaceId = requireSessionByDatabaseId(databaseId).workspaceId;
        return getEmail(workspaceId, emailId);
      },
      async setStatus(emailId, status, failReason) {
        await updateEmailStatus(emailId, status, failReason);
        return true;
      },
      async delete(emailId) {
        await deleteEmail(emailId);
        return true;
      },
      async listAttachments(emailId) {
        return listEmailAttachments(emailId);
      },
      async getAttachment(attachmentId) {
        return getEmailAttachment(attachmentId);
      },
      async getAttachmentContent(attachmentId) {
        const att = await getEmailAttachment(attachmentId);
        if (!att) return "";
        return decodeAttachmentText(att);
      },
      async send(input) {
        const workspaceId = requireSessionByDatabaseId(databaseId).workspaceId;
        return sendWorkspaceEmail(workspaceId, input);
      },
      async draftReply(input) {
        // Stage a reply WITHOUT sending it. The email agent reads this draft
        // after the workflow's audit node and sends it only if the audit
        // passes (fail-closed). Use this in email-triggered workflows instead
        // of `send` so a response never leaves without a passing audit.
        setParameter("__outbound_reply", input);
        addMessage({
          role: "tool",
          markdown: "Reply drafted — it will be sent only if the workflow audit passes.",
        });
        return true;
      },
    },
    getReportContext,
  };

  (api as any).sessionId = hostSession.session_id;
  (api as any).databaseId = databaseId;

  return api;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * First human-readable line of a workflow description: skips blank lines, the
 * `*Created: …*` italic marker, and markdown headings, so `workflows.list()`
 * returns a useful summary instead of the date line.
 */
function firstMeaningfulLine(desc?: unknown): string {
  if (typeof desc !== "string") return "";
  for (const raw of desc.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (/^\*.*\*$/.test(line)) continue;
    return line.slice(0, 200);
  }
  return "";
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markdownToInlineHtml(markdown: string): string {
  // Bare-bones inline rendering — paragraphs + line breaks. The actual chat
  // panel renders full markdown elsewhere; this just keeps the prompt readable.
  return markdown
    .split("\n\n")
    .map(
      (p) =>
        `<p class="text-sm text-gray-700 dark:text-gray-300 mb-3">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

/**
 * Validate a pause prompt's form against the FormField contract before render.
 * Throws a precise, actionable error on any type violation. We fail loud here
 * (rather than coercing) so untyped data never flows.
 */
function validatePauseForm(prompt: PausePrompt): void {
  const fields = prompt?.form?.fields;
  if (fields === undefined) return; // a markdown/html-only pause is valid
  if (!Array.isArray(fields)) {
    throw new Error(
      "pauseForInput: form.fields must be an array of FormField objects.",
    );
  }
  const SELECT_TYPES = new Set(["select", "radio"]);
  fields.forEach((f: any, i: number) => {
    if (!f || typeof f !== "object") {
      throw new Error(
        `pauseForInput: form.fields[${i}] must be a FormField object.`,
      );
    }
    if (typeof f.name !== "string" || !f.name.trim()) {
      throw new Error(
        `pauseForInput: form.fields[${i}].name is required and must be a non-empty string.`,
      );
    }
    if (SELECT_TYPES.has(f.type)) {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        throw new Error(
          `pauseForInput: select field "${f.name}" requires a non-empty options array of { value, label } objects.`,
        );
      }
      f.options.forEach((o: any, j: number) => {
        if (
          typeof o !== "object" ||
          o === null ||
          typeof o.value !== "string" ||
          typeof o.label !== "string"
        ) {
          const got = typeof o === "string" ? `the string "${o}"` : typeof o;
          throw new Error(
            `pauseForInput: select field "${f.name}" options[${j}] must be { value: string, label: string } (got ${got}). ` +
              `Use [{ value: "approve", label: "Approve" }], not ["Approve"].`,
          );
        }
      });
    }
  });
}

function renderPauseFormHtml(
  sessionId: string,
  pauseId: string,
  prompt: PausePrompt,
): string {
  const promptHtml = prompt.html
    ? prompt.html
    : prompt.markdown
      ? markdownToInlineHtml(prompt.markdown)
      : "";

  const fields = prompt.form?.fields ?? [];
  const fieldHtml = fields
    .map((f: FormField) => {
      const label = escapeHtml(f.label || f.name);
      const description = f.description
        ? `<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${escapeHtml(f.description)}</div>`
        : "";
      const required = f.required ? "required" : "";
      const baseInputCls =
        "mt-1 w-full px-3 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
      let input = "";
      switch (f.type) {
        case "textarea":
          input = `<textarea name="${escapeHtml(f.name)}" rows="3" ${required} class="${baseInputCls}">${escapeHtml(String(f.value ?? ""))}</textarea>`;
          break;
        case "number":
          input = `<input type="number" name="${escapeHtml(f.name)}" value="${escapeHtml(String(f.value ?? ""))}" ${required} class="${baseInputCls}" />`;
          break;
        case "date":
          input = `<input type="date" name="${escapeHtml(f.name)}" value="${escapeHtml(String(f.value ?? ""))}" ${required} class="${baseInputCls}" />`;
          break;
        case "boolean":
          input = `<label class="inline-flex items-center gap-2 text-sm mt-1"><input type="checkbox" name="${escapeHtml(f.name)}" value="true" ${f.value ? "checked" : ""} /> ${label}</label>`;
          break;
        case "select": {
          const options = (f.options ?? [])
            .map(
              (o: { value: string; label: string }) =>
                `<option value="${escapeHtml(o.value)}" ${o.value === String(f.value ?? "") ? "selected" : ""}>${escapeHtml(o.label)}</option>`,
            )
            .join("");
          input = `<select name="${escapeHtml(f.name)}" ${required} class="${baseInputCls}">${options}</select>`;
          break;
        }
        default:
          input = `<input type="text" name="${escapeHtml(f.name)}" value="${escapeHtml(String(f.value ?? ""))}" ${required} class="${baseInputCls}" />`;
      }
      const labelEl =
        f.type === "boolean"
          ? ""
          : `<label class="block text-sm font-medium text-gray-700 dark:text-gray-300">${label}${f.required ? " *" : ""}</label>`;
      return `<div class="mb-3">${labelEl}${input}${description}</div>`;
    })
    .join("");

  return `<form
    hx-post="/sessions/${escapeHtml(sessionId)}/resume-pause"
    hx-target="this"
    hx-swap="outerHTML"
    class="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg"
  >
    <input type="hidden" name="pauseId" value="${escapeHtml(pauseId)}" />
    ${promptHtml ? `<div class="mb-3">${promptHtml}</div>` : ""}
    ${fieldHtml}
    <div class="flex items-center justify-end">
      <button type="submit" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium">
        Continue
      </button>
    </div>
  </form>`;
}
