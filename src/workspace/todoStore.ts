/**
 * Workspace Todo Store
 *
 * Backed by the active WorkspaceSession's `todos` array (top-level `.wfp`
 * node). The .wfp spec defines `TodoEntry` with status pending | in_progress |
 * done | cancelled; the host's runtime uses pending | done | skipped (skipped
 * is mapped to spec's "cancelled" on save and restored on load).
 *
 * Plan items live in a separate `plan[]` node and are managed by planStore.ts.
 */

import { requireSessionByDatabaseId, getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { TodoEntry, TodoType } from "wfp-format";

export interface WorkspaceTodo {
  todoId: string;
  label: string;
  instruction: string;
  /** "draft" = saved in a list but not yet activated (Run not clicked); kept out
   *  of Open todos / Overview. "in_progress" = a run started but not signed off. */
  status: "draft" | "pending" | "in_progress" | "done" | "skipped";
  type: TodoType;
  /** Target workflow for type "workflow" todos. */
  workflowId: string;
  /** Analytics: named run, creating workflow, and a free-form tag. */
  instanceName: string;
  creatingWorkflow: string;
  tag: string;
  /** Optional target/due date (ISO `YYYY-MM-DD`). Display only. */
  dueDate: string;
  /** Free-form human notes. Documentation only — never passed to a run. */
  notes: string;
  /** Estimated effort in hours (0 = unset). Display only. */
  hours: number;
  sortOrder: number;
  source: string;
  category: string;
  createdAt: string;
  /** ISO timestamp of when the list was last Run (activated). "" if never run. */
  runAt: string;
}

// ── Conversions ────────────────────────────────────────────────────────────

function toSpec(host: WorkspaceTodo): TodoEntry {
  return {
    id: host.todoId,
    label: host.label,
    instruction: host.instruction,
    status:
      host.status === "skipped" ? "cancelled"
      : host.status === "draft" ? "pending"
      : host.status,
    ...(host.status === "draft" ? { draft: true } : {}),
    ...(host.runAt ? { run_at: host.runAt } : {}),
    type: host.type,
    ...(host.workflowId ? { workflow_id: host.workflowId } : {}),
    ...(host.instanceName ? { instance_name: host.instanceName } : {}),
    ...(host.creatingWorkflow ? { creating_workflow: host.creatingWorkflow } : {}),
    ...(host.tag ? { tag: host.tag } : {}),
    ...(host.dueDate ? { due_date: host.dueDate } : {}),
    ...(host.notes ? { notes: host.notes } : {}),
    ...(host.hours ? { hours: host.hours } : {}),
    sort_order: host.sortOrder,
    source: host.source,
    category: host.category,
    created_at: host.createdAt,
  } as TodoEntry;
}

function fromSpec(spec: TodoEntry): WorkspaceTodo {
  let status: WorkspaceTodo["status"] = "pending";
  if (spec.status === "done") status = "done";
  else if (spec.status === "cancelled") status = "skipped";
  else if (spec.status === "in_progress") status = "in_progress";
  if ((spec as { draft?: boolean }).draft && status === "pending") status = "draft";
  return {
    todoId: spec.id ?? "",
    label: spec.label,
    instruction: spec.instruction ?? "",
    status,
    type: spec.type ?? "manual",
    workflowId: spec.workflow_id ?? "",
    instanceName: spec.instance_name ?? "",
    creatingWorkflow: spec.creating_workflow ?? "",
    tag: spec.tag ?? "",
    dueDate: spec.due_date ?? "",
    notes: spec.notes ?? "",
    hours: spec.hours ?? 0,
    sortOrder: spec.sort_order ?? 0,
    source: spec.source ?? "user",
    category: spec.category ?? "general",
    createdAt: spec.created_at ?? new Date().toISOString(),
    runAt: (spec as { run_at?: string }).run_at ?? "",
  };
}

// ── No-op compat shim (was creating the SQLite table) ──────────────────────
export function ensureTodoTable(_databaseId: string): void {
  // No-op post-M11g.
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export function addTodo(
  databaseId: string,
  todo: { label: string; instruction: string; type: TodoType; workflowId?: string; instanceName?: string; creatingWorkflow?: string; tag?: string; dueDate?: string; notes?: string; hours?: number; source?: string; category?: string; sortOrder?: number },
): WorkspaceTodo {
  const ws = requireSessionByDatabaseId(databaseId);
  const existing = ws.getTodos().map(fromSpec);

  const sortOrder =
    todo.sortOrder !== undefined
      ? todo.sortOrder
      : (existing.length > 0 ? Math.max(...existing.map((t) => t.sortOrder)) + 1 : 0);

  const created: WorkspaceTodo = {
    todoId: crypto.randomUUID(),
    label: todo.label,
    instruction: todo.instruction,
    status: "pending",
    type: todo.type,
    workflowId: todo.workflowId || "",
    instanceName: todo.instanceName || "",
    creatingWorkflow: todo.creatingWorkflow || "",
    tag: todo.tag || "",
    dueDate: todo.dueDate || "",
    notes: todo.notes || "",
    hours: todo.hours || 0,
    sortOrder,
    source: todo.source || "user",
    category: todo.category || "general",
    createdAt: new Date().toISOString(),
    runAt: "",
  };

  const next = [...existing, created];
  ws.setTodos(next.map(toSpec));
  return created;
}

export function listTodos(
  databaseId: string,
  filter?: { status?: string },
): WorkspaceTodo[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  let todos = ws.getTodos().map(fromSpec);
  if (filter?.status) todos = todos.filter((t) => t.status === filter.status);
  todos.sort((a, b) => a.sortOrder - b.sortOrder);
  return todos;
}

export function getTodo(databaseId: string, todoId: string): WorkspaceTodo | null {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return null;
  const match = ws.getTodos().find((t) => t.id === todoId);
  return match ? fromSpec(match) : null;
}

export function updateTodoStatus(
  databaseId: string,
  todoId: string,
  status: "pending" | "in_progress" | "done" | "skipped",
): boolean {
  const ws = requireSessionByDatabaseId(databaseId);
  const todos = ws.getTodos().map(fromSpec);
  const idx = todos.findIndex((t) => t.todoId === todoId);
  if (idx === -1) return false;
  todos[idx] = { ...todos[idx], status };
  ws.setTodos(todos.map(toSpec));
  return true;
}

export function deleteTodo(databaseId: string, todoId: string): boolean {
  const ws = requireSessionByDatabaseId(databaseId);
  const todos = ws.getTodos().map(fromSpec);
  const next = todos.filter((t) => t.todoId !== todoId);
  if (next.length === todos.length) return false;
  ws.setTodos(next.map(toSpec));
  return true;
}

export function clearDoneTodos(databaseId: string): number {
  const ws = requireSessionByDatabaseId(databaseId);
  const todos = ws.getTodos().map(fromSpec);
  const keep = todos.filter((t) => t.status !== "done" && t.status !== "skipped");
  const removed = todos.length - keep.length;
  if (removed > 0) ws.setTodos(keep.map(toSpec));
  return removed;
}

/** Remove every todo (pending, done, and skipped). Returns the count removed. */
export function clearAllTodos(databaseId: string): number {
  const ws = requireSessionByDatabaseId(databaseId);
  const count = ws.getTodos().length;
  if (count > 0) ws.setTodos([]);
  return count;
}

// ── Instance (todo-list) operations ─────────────────────────────────────────
// A "todo list" is the set of todos sharing one `instanceName`. These helpers
// group/slice the flat array at read time — the stored shape stays a flat
// `TodoEntry[]` (no nesting, no duplicated instance key).

export interface TodoInstanceSummary {
  instanceName: string;
  total: number;
  done: number;
  pending: number;
  inProgress: number;
  /** Sum of estimated hours across the list's todos. */
  hours: number;
  createdAt: string;
}

/** One summary row per distinct instanceName (skips unnamed/ad-hoc todos). */
export function listInstances(databaseId: string): TodoInstanceSummary[] {
  const todos = listTodos(databaseId);
  const byName = new Map<string, WorkspaceTodo[]>();
  for (const t of todos) {
    if (!t.instanceName) continue;
    const arr = byName.get(t.instanceName) ?? [];
    arr.push(t);
    byName.set(t.instanceName, arr);
  }
  const out: TodoInstanceSummary[] = [];
  for (const [instanceName, rows] of byName) {
    out.push({
      instanceName,
      total: rows.length,
      done: rows.filter((t) => t.status === "done").length,
      pending: rows.filter((t) => t.status === "pending").length,
      inProgress: rows.filter((t) => t.status === "in_progress").length,
      hours: rows.reduce((sum, t) => sum + (t.hours || 0), 0),
      createdAt: rows.reduce((min, t) => (t.createdAt < min ? t.createdAt : min), rows[0].createdAt),
    });
  }
  // Newest list first.
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

/** All todos belonging to one named list, in sort order. */
export function getInstance(databaseId: string, instanceName: string): WorkspaceTodo[] {
  return listTodos(databaseId).filter((t) => t.instanceName === instanceName);
}

export interface TodoListRow {
  label: string;
  instruction?: string;
  type: TodoType;
  workflowId?: string;
  tag?: string;
  dueDate?: string;
  notes?: string;
  hours?: number;
  category?: string;
}

/** Identity of a row within a list, for carrying status across a re-save:
 *  workflow rows match by workflow id; free steps match by their label. */
function rowKey(r: { type?: TodoType; workflowId?: string; label: string }): string {
  return r.type === "workflow" && r.workflowId ? `wf:${r.workflowId}` : `free:${r.label}`;
}

/**
 * Replace the entire contents of a named list (Save / Run, light model).
 * Rewrites the list from `rows`, preserving the status (and id/createdAt) of any
 * row that still exists — matched by workflow id, or by label for free steps —
 * so editing a list doesn't reset progress on unchanged tasks. New rows start
 * `pending`; removed rows are dropped. Order follows `rows` (sortOrder = index).
 * Other lists are untouched.
 */
export function replaceInstance(
  databaseId: string,
  instanceName: string,
  rows: TodoListRow[],
  opts?: { creatingWorkflow?: string; source?: string },
): WorkspaceTodo[] {
  const ws = requireSessionByDatabaseId(databaseId);
  const all = ws.getTodos().map(fromSpec);
  const others = all.filter((t) => t.instanceName !== instanceName);

  // Index existing rows of this list so we can carry status forward.
  const prior = new Map<string, WorkspaceTodo>();
  for (const t of all) {
    if (t.instanceName === instanceName) prior.set(rowKey(t), t);
  }

  const created: WorkspaceTodo[] = rows.map((row, i) => {
    const existing = prior.get(rowKey(row));
    return {
      todoId: existing?.todoId ?? crypto.randomUUID(),
      label: row.label,
      instruction: row.instruction ?? "",
      // New rows start as "draft" — saving/editing a list does NOT run it. The
      // list only becomes "open" (todos → pending) when Run is clicked
      // (runInstance). Existing rows keep their status (don't reset progress).
      status: existing?.status ?? "draft",
      type: row.type,
      workflowId: row.workflowId ?? "",
      instanceName,
      creatingWorkflow: opts?.creatingWorkflow ?? existing?.creatingWorkflow ?? "",
      tag: row.tag ?? "",
      dueDate: row.dueDate ?? "",
      notes: row.notes ?? "",
      hours: row.hours ?? 0,
      sortOrder: i,
      source: opts?.source ?? existing?.source ?? "user",
      category: row.category ?? "general",
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      runAt: existing?.runAt ?? "",
    };
  });

  ws.setTodos([...others, ...created].map(toSpec));
  return created;
}

/**
 * Save As — clone a list under a new name with statuses reset to pending and
 * fresh ids. Returns the new rows. No-op (returns []) if the source is empty.
 */
export function cloneInstance(
  databaseId: string,
  fromInstance: string,
  toInstance: string,
): WorkspaceTodo[] {
  const src = getInstance(databaseId, fromInstance);
  if (src.length === 0) return [];
  const rows: TodoListRow[] = src.map((t) => ({
    label: t.label,
    instruction: t.instruction,
    type: t.type,
    workflowId: t.workflowId,
    tag: t.tag,
    dueDate: t.dueDate,
    notes: t.notes,
    hours: t.hours,
    category: t.category,
  }));
  return replaceInstance(databaseId, toInstance, rows, {
    creatingWorkflow: src[0].creatingWorkflow,
    source: "user",
  });
}

/**
 * Run (activate) a named list: set every todo in it to "pending" so the list
 * becomes "open" and surfaces in Open todos. Resets draft/done rows so a re-run
 * starts fresh. Returns the count activated.
 */
export function runInstance(databaseId: string, instanceName: string): number {
  const ws = requireSessionByDatabaseId(databaseId);
  const todos = ws.getTodos().map(fromSpec);
  const now = new Date().toISOString();
  let count = 0;
  const next = todos.map((t) => {
    if (t.instanceName === instanceName) {
      count++;
      return { ...t, status: "pending" as const, runAt: now };
    }
    return t;
  });
  if (count > 0) ws.setTodos(next.map(toSpec));
  return count;
}

/** A list is "open" when any of its todos is pending or in_progress. */
export function isInstanceOpen(databaseId: string, instanceName: string): boolean {
  return getInstance(databaseId, instanceName).some(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
}

/** Delete an entire named list. Returns the count removed. */
export function deleteInstance(databaseId: string, instanceName: string): number {
  const ws = requireSessionByDatabaseId(databaseId);
  const todos = ws.getTodos().map(fromSpec);
  const keep = todos.filter((t) => t.instanceName !== instanceName);
  const removed = todos.length - keep.length;
  if (removed > 0) ws.setTodos(keep.map(toSpec));
  return removed;
}
