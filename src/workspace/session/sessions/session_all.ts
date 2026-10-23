// session_all — CRUD for runtime workflow sessions (M11f).
//
// Sessions live in the active WorkspaceSession's `sessions` array. The host's
// `Session` type carries many fields not in the .wfp 1.0.0 spec (workflow
// stack, awaiting flags, vision context, etc.); those are stashed inside
// the spec Session's `metadata.host` blob. Spec-standard fields (id, name,
// workflow_id, status, messages, created_at, updated_at) live in their
// proper slots.
//
// Function signatures are unchanged so the rest of the host doesn't need
// to migrate.

import { v4 as uuidv4 } from "uuid";
import { Session } from "@backend/types";
import type { Session as SpecSession, SessionStatus } from "wfp-format";
import {
  getSessionByDatabaseId,
  requireSessionByDatabaseId,
} from "@backend/core/workspace/workspaceSessionStore";
import { summarizeJudgeResult, type JudgeSummary } from "../judgeSummary";

// ── status mapping ──────────────────────────────────────────────────────────

const SPEC_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  "pending",
  "in_progress",
  "awaiting_feedback",
  "awaiting_approval",
  "completed",
  "cancelled",
  "blocked",
]);

function toSpecStatus(instanceStatus: string | null | undefined, waitingForInput: boolean, waitingForApproval: boolean): SessionStatus {
  if (waitingForInput) return "awaiting_feedback";
  if (waitingForApproval) return "awaiting_approval";
  if (!instanceStatus) return "pending";
  if (SPEC_STATUSES.has(instanceStatus as SessionStatus)) return instanceStatus as SessionStatus;
  // Map common host values
  switch (instanceStatus) {
    case "running":
    case "active":
      return "in_progress";
    case "done":
      return "completed";
    case "error":
    case "failed":
      return "blocked";
    case "paused":
      return "awaiting_feedback";
    default:
      return "in_progress";
  }
}

// ── host ⇄ spec conversion ─────────────────────────────────────────────────

function toSpec(host: Session): SpecSession {
  const messages = (host.messages ?? []).map((m: any) => ({
    ...m,
    // Spec messages have a `timestamp` string; host may store a Date.
    timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
  }));
  const status = toSpecStatus(
    host.instance_status,
    !!host.waitingForInput,
    !!host.waitingForApproval,
  );
  const kind = host.activeWorkflowId ? "automation" : "chat";

  // Everything host-only goes under metadata.host. Standard `metadata` keys
  // a caller might have set are preserved by spreading first.
  const callerMeta = host.metadata ?? {};
  return {
    id: host.session_id,
    name: host.sessionName,
    workflow_id: host.activeWorkflowId,
    kind,
    status,
    messages,
    created_at: host.createdAt instanceof Date ? host.createdAt.toISOString() : String(host.createdAt ?? new Date().toISOString()),
    updated_at: host.updatedAt instanceof Date ? host.updatedAt.toISOString() : String(host.updatedAt ?? new Date().toISOString()),
    ...(status === "completed" ? { completed_at: new Date().toISOString() } : {}),
    metadata: {
      ...callerMeta,
      host: {
        workflows: host.workflows ?? {},
        tasks: host.tasks ?? [],
        spreadsheet_history: host.spreadsheet_history ?? [],
        selectedCategories: host.selectedCategories ?? [],
        selectedTools: host.selectedTools ?? [],
        currentActionIndex: host.currentActionIndex ?? null,
        currentUserMessage: host.currentUserMessage ?? null,
        user_id: host.user_id ?? null,
        client_id: host.client_id ?? null,
        month: host.month ?? null,
        instance_status: host.instance_status ?? null,
        scheduled_start_date: host.scheduled_start_date ?? null,
        waitingForInput: !!host.waitingForInput,
        waitingForApproval: !!host.waitingForApproval,
      },
    },
  };
}

function fromSpec(spec: SpecSession): Session {
  const hostExtras = ((spec.metadata as any)?.host ?? {}) as Record<string, any>;
  return {
    session_id: spec.id,
    createdAt: new Date(spec.created_at),
    updatedAt: new Date(spec.updated_at),
    sessionName: spec.name,
    workflows: hostExtras.workflows ?? {},
    activeWorkflowId: spec.workflow_id,
    messages: spec.messages ?? [],
    tasks: hostExtras.tasks ?? [],
    metadata: spec.metadata as any,
    selectedCategories: hostExtras.selectedCategories ?? [],
    selectedTools: hostExtras.selectedTools ?? [],
    spreadsheet_history: hostExtras.spreadsheet_history ?? [],
    actions: [],
    currentActionIndex: hostExtras.currentActionIndex ?? undefined,
    currentUserMessage: hostExtras.currentUserMessage ?? undefined,
    currentWorkflowIndex: 0,
    user_id: hostExtras.user_id ?? undefined,
    client_id: hostExtras.client_id ?? undefined,
    month: hostExtras.month ?? undefined,
    instance_status: hostExtras.instance_status ?? null,
    scheduled_start_date: hostExtras.scheduled_start_date ?? undefined,
    waitingForInput: !!hostExtras.waitingForInput,
    waitingForApproval: !!hostExtras.waitingForApproval,
    waitingForManualStart: false,
    memoryContext: "",
  } as unknown as Session;
}

/** True for an ephemeral "page" run's session (set by runWorkflowEphemeral).
 *  Such sessions are excluded from every session list and GC'd after a TTL. */
function isTransientSpec(spec: SpecSession): boolean {
  return (spec.metadata as any)?.transient === true;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

/**
 * CREATE — generates a session_id and persists an empty session in the
 * active WorkspaceSession.
 */
export const createSession = async (
  databaseId: string,
  userId: string,
  sessionName?: string,
): Promise<Session> => {
  const sessionId = uuidv4();
  const now = new Date();
  const session: Session = {
    session_id: sessionId,
    createdAt: now,
    updatedAt: now,
    sessionName: sessionName || "New Session",
    workflows: {},
    activeWorkflowId: undefined,
    user_id: userId,
    currentWorkflowIndex: 0,
    actions: [],
    messages: [],
    tasks: [],
    metadata: {},
    selectedCategories: [],
    selectedTools: [],
    spreadsheet_history: [],
    waitingForInput: false,
    waitingForApproval: false,
    waitingForManualStart: false,
    memoryContext: "",
    instance_status: "pending",
  } as Session;

  const ws = requireSessionByDatabaseId(databaseId);
  ws.upsertSession(toSpec(session));
  return session;
};

/**
 * READ — fetch a host Session by session_id from the active workspace.
 */
export const getSession = async (
  databaseId: string,
  sessionId: string,
): Promise<Session | null> => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return null;
  const spec = ws.getSession(sessionId);
  if (!spec) return null;
  return fromSpec(spec);
};

/**
 * UPDATE — partial update by field name. Mirrors the legacy
 * `UPDATE app_sessions SET key = ?` API so existing callers don't change.
 */
export const updateSession = async (
  databaseId: string,
  sessionId: string,
  key: string,
  value: any,
): Promise<Session> => {
  const ws = requireSessionByDatabaseId(databaseId);
  const spec = ws.getSession(sessionId);
  if (!spec) throw new Error("Session not found");
  const host = fromSpec(spec);

  // Map snake_case host SQL column names to host Session keys.
  const fieldMap: Record<string, string> = {
    session_name: "sessionName",
    workflow_id: "activeWorkflowId",
    workflow_stack: "workflows",
    current_action_index: "currentActionIndex",
    current_user_message: "currentUserMessage",
    waiting_for_input: "waitingForInput",
    waiting_for_approval: "waitingForApproval",
    selected_categories: "selectedCategories",
    selected_tools: "selectedTools",
    spreadsheet_history: "spreadsheet_history",
    instance_status: "instance_status",
    scheduled_start_date: "scheduled_start_date",
    user_id: "user_id",
    client_id: "client_id",
    month: "month",
    metadata: "metadata",
    messages: "messages",
    tasks: "tasks",
  };
  const hostKey = fieldMap[key] ?? key;

  // SQLite stored objects as JSON strings; if we get a string-shaped JSON
  // for an array/object field, parse it.
  let normalized = value;
  if (typeof value === "string") {
    const arrayKeys = new Set([
      "messages",
      "tasks",
      "selectedCategories",
      "selectedTools",
      "spreadsheet_history",
    ]);
    const objectKeys = new Set(["metadata", "workflows"]);
    if (arrayKeys.has(hostKey) || objectKeys.has(hostKey)) {
      try {
        normalized = JSON.parse(value);
      } catch { /* keep as string */ }
    }
  }
  if (key === "waiting_for_input" || key === "waiting_for_approval") {
    normalized = !!value;
  }

  (host as any)[hostKey] = normalized;
  host.updatedAt = new Date();
  ws.upsertSession(toSpec(host));
  return host;
};

/** Extract a short "why" from a session's concluding assistant message, so the
 *  workflow-completed checkpoint carries the actual outcome, not just a label. */
function extractRationale(session: Session): string | undefined {
  const msgs = session.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i] as { role?: string; markdown?: string; html?: string } | undefined;
    if (m?.role === "assistant") {
      const text = (m.markdown ?? m.html ?? "").trim();
      if (text) return text.slice(0, 320);
    }
  }
  return undefined;
}

/**
 * Save/update full session to the active workspace.
 */
export const saveSession = async (
  databaseId: string,
  session: Session,
): Promise<void> => {
  if (session.session_id.startsWith("dummy-test-")) {
    console.log("Test only - skip save session:", session.session_id);
    return;
  }
  const ws = requireSessionByDatabaseId(databaseId);
  session.updatedAt = new Date();
  const spec = toSpec(session);
  const prev = ws.getSession(session.session_id);
  const justCompletedWorkflow =
    !!session.activeWorkflowId &&
    spec.status === "completed" &&
    prev?.status !== "completed";
  ws.upsertSession(spec);
  if (justCompletedWorkflow) {
    ws.recordCheckpoint({
      label: `Workflow completed — ${session.sessionName || session.activeWorkflowId}`,
      rationale: extractRationale(session),
    });
  }
};

/**
 * DELETE — remove a session by id.
 */
export const deleteSession = async (
  databaseId: string,
  sessionId: string,
): Promise<boolean> => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return false;
  return ws.deleteSession(sessionId);
};

/**
 * GC TRANSIENT SESSIONS — drop ephemeral "page"-run sessions older than the TTL.
 * Called opportunistically when a new ephemeral run starts, so they don't
 * accumulate. Returns the number removed.
 */
export const gcTransientSessions = (
  databaseId: string,
  maxAgeMs = 30 * 60 * 1000,
): number => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const s of ws.getSessions()) {
    if (!isTransientSpec(s)) continue;
    const updated = Date.parse(s.updated_at ?? "") || 0;
    if (updated < cutoff) {
      if (ws.deleteSession(s.id)) removed++;
    }
  }
  return removed;
};

/**
 * GET ALL SESSIONS — newest first, optional search and limit.
 */
export const getAllSessions = async (
  databaseId: string,
  options?: { limit?: number; searchQuery?: string },
): Promise<Session[]> => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  // Transient sessions back ephemeral "page" runs (a workflow opened from the
  // nav). They never appear in any session list — see runWorkflowEphemeral.
  let sessions = ws.getSessions().filter((s) => !isTransientSpec(s)).map(fromSpec);

  if (options?.searchQuery) {
    const q = options.searchQuery.toLowerCase();
    sessions = sessions.filter(
      (s) =>
        (s.sessionName ?? "").toLowerCase().includes(q) ||
        s.session_id.toLowerCase().includes(q),
    );
  }
  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  if (options?.limit && options.limit > 0) {
    sessions = sessions.slice(0, options.limit);
  }
  return sessions;
};

/**
 * MAP TODO → LATEST SESSION — { todoId: sessionId } for every session launched
 * from a "workflow" todo (it stamped `metadata.sourceTodoId` at run start).
 * Lets the right panel link a todo to its run so it can be VIEWED again (and
 * signed off) instead of starting a fresh run on every click.
 */
export const getSessionIdsByTodo = (databaseId: string): Record<string, string> => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return {};
  const latest: Record<string, { id: string; updated: string }> = {};
  for (const s of ws.getSessions()) {
    const tid = (s.metadata as any)?.sourceTodoId as string | undefined;
    if (!tid) continue;
    const updated = s.updated_at ?? "";
    if (!latest[tid] || updated > latest[tid].updated) latest[tid] = { id: s.id, updated };
  }
  const out: Record<string, string> = {};
  for (const k in latest) out[k] = latest[k].id;
  return out;
};

/**
 * GET SESSION COUNTS BY WORKFLOW — { workflowId: count }.
 */
export const getSessionCountsByWorkflow = (
  databaseId: string,
): Record<string, number> => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return {};
  const counts: Record<string, number> = {};
  for (const s of ws.getSessions()) {
    if (s.workflow_id) counts[s.workflow_id] = (counts[s.workflow_id] ?? 0) + 1;
  }
  return counts;
};

/**
 * GET RECENT USER PROMPTS — the most recent user-typed messages across all
 * non-transient sessions, newest first, de-duplicated. Feeds the chat page's
 * "recent prompts" panel so users can re-use a previous prompt with one click.
 */
export const getRecentPrompts = (
  databaseId: string,
  limit = 5,
): { prompt: string; session_id: string; timestamp: number }[] => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];

  const strip = (s: string) =>
    (s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  const items: { prompt: string; session_id: string; timestamp: number }[] = [];
  const seen = new Set<string>();

  for (const s of ws.getSessions()) {
    if (isTransientSpec(s)) continue;
    for (const m of (s.messages ?? []) as any[]) {
      if (m?.role !== "user") continue;
      const text = strip(m.markdown || m.html || "");
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ts =
        m.timestamp instanceof Date
          ? m.timestamp.getTime()
          : Date.parse(m.timestamp || "") || 0;
      items.push({ prompt: text, session_id: s.id, timestamp: ts });
    }
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, limit);
};

/**
 * GET WORKFLOW SESSIONS — lightweight rows for a workflow's history UI.
 */
export const getWorkflowSessions = (
  databaseId: string,
  workflowId: string,
  limit = 10,
): {
  session_id: string;
  session_name: string;
  instance_status: string;
  created_at: string;
  updated_at: string;
}[] => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  return ws
    .getSessions()
    .filter((s) => s.workflow_id === workflowId && !isTransientSpec(s))
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, limit)
    .map((s) => ({
      session_id: s.id,
      session_name: s.name ?? "",
      instance_status:
        ((s.metadata as any)?.host?.instance_status as string | null) ?? s.status ?? "",
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));
};

/**
 * Read the compact check_data / judge_data summary for a session. The chat
 * orchestrator persists it under `metadata.judgeSummary`; workflow runs store
 * the tool result in the run_MCP message's `json.result`, so fall back to
 * scanning those messages.
 */
function readJudgeSummary(spec: SpecSession): JudgeSummary | null {
  const meta = (spec.metadata as any)?.judgeSummary as JudgeSummary | undefined;
  if (meta && (meta.checks !== undefined || meta.judged !== undefined)) return meta;
  for (const m of (spec.messages ?? []) as any[]) {
    const j = m?.json;
    const tool = j?.toolName ?? j?.tool;
    if (tool !== "check_data" && tool !== "judge_data") continue;
    const summary = summarizeJudgeResult(tool, j?.result);
    if (summary) return summary;
  }
  return null;
}

/**
 * GET RECENT SESSIONS — chat panel history (with workflow name + first user
 * message preview).
 */
export const getRecentSessions = (
  databaseId: string,
  limit = 20,
): {
  session_id: string;
  session_name: string;
  instance_status: string;
  kind: "automation" | "chat";
  workflow_name: string | null;
  message_count: number;
  first_message: string | null;
  judge_summary: JudgeSummary | null;
  created_at: string;
  updated_at: string;
}[] => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];

  const workflowNames = new Map<string, string>();
  for (const w of ws.getWorkflows()) workflowNames.set(w.id, w.name);

  const sessions = ws.getSessions().filter((s) => !isTransientSpec(s));
  sessions.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  return sessions.slice(0, limit).map((s) => {
    const messages = s.messages ?? [];
    let firstMessage: string | null = null;
    const userMsg = messages.find((m: any) => m.role === "user");
    if (userMsg) {
      const text = (userMsg.markdown as string) ||
        ((userMsg.html as string) ?? "").replace(/<[^>]*>/g, "") || "";
      firstMessage = text.slice(0, 45) || null;
    }
    return {
      session_id: s.id,
      session_name: s.name ?? "",
      instance_status:
        ((s.metadata as any)?.host?.instance_status as string | null) ?? s.status ?? "",
      kind: (s.kind ?? (s.workflow_id ? "automation" : "chat")) as "automation" | "chat",
      workflow_name: s.workflow_id ? workflowNames.get(s.workflow_id) ?? null : null,
      message_count: messages.length,
      first_message: firstMessage,
      judge_summary: readJudgeSummary(s),
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });
};

/**
 * DELETE WORKFLOW SESSIONS — remove all sessions associated with a workflow.
 */
export const deleteWorkflowSessions = (
  databaseId: string,
  workflowId: string,
): void => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return;
  for (const s of ws.getSessions()) {
    if (s.workflow_id === workflowId) ws.deleteSession(s.id);
  }
};

/**
 * DELETE ALL SESSIONS — remove every non-transient session in the workspace
 * (chat + automation runs). Ephemeral "page"-run sessions are preserved; they
 * auto-GC after their TTL. Returns the number removed.
 */
export const deleteAllSessions = (databaseId: string): number => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return 0;
  let removed = 0;
  for (const s of ws.getSessions()) {
    if (!isTransientSpec(s) && ws.deleteSession(s.id)) removed++;
  }
  return removed;
};
