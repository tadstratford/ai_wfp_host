/**
 * Workflow Status Derivation
 *
 * Computes the dashboard status for each workflow by inspecting:
 * - Session run history (complete, in_progress, blocked, etc.)
 * - Parameter satisfaction (are all {{param}} references resolvable?)
 * - Workflow dependencies (depends_on field)
 * - Data freshness (has input data changed since last run?)
 *
 * Post-M11g: every read comes from the active WorkspaceSession.
 */

import { requireSessionByDatabaseId, getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkflowRunStatus =
  | "not_run"       // No session exists for this workflow
  | "running"       // Session in_progress
  | "complete"      // Latest session completed
  | "stale"         // Completed but input data changed after completion
  | "flagged"       // Completed but workflow output had exceptions
  | "blocked"       // Upstream dependencies not yet complete, or missing data
  | "ready";        // All dependencies met, all params satisfied, ready to run

export interface WorkflowStatusCard {
  workflowId: string;
  name: string;
  /** Optional nav group (workflow.group); shown as a chip on the board. */
  group: string | null;
  sortOrder: number;
  depthLevel: number;
  dependsOn: string[];
  status: WorkflowRunStatus;
  lastRunDate: string | null;
  lastRunSummary: string | null;
  flagCount: number;
  missingParams: string[];
  blockedBy: string[];
}

export interface WorkspaceStatus {
  period: string | null;
  workspaceNotes: WorkspaceNote[];
  workflows: WorkflowStatusCard[];
  totalWorkflows: number;
  completedWorkflows: number;
  progressPercent: number;
}

export interface WorkspaceNote {
  text: string;
  createdAt: string;
}

// ── Main Function ────────────────────────────────────────────────────────────

export function getWorkspaceStatus(databaseId: string): WorkspaceStatus {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) {
    return {
      period: null,
      workspaceNotes: [],
      workflows: [],
      totalWorkflows: 0,
      completedWorkflows: 0,
      progressPercent: 0,
    };
  }

  // Workspace meta
  const metadata = ws.getMetadata();
  const period = metadata.period ?? null;
  const workspaceNotes: WorkspaceNote[] = (metadata.notes ?? []).map((n) => ({
    text: n.text,
    createdAt: n.created_at,
  }));

  // Workflows (sorted by sort_order, then created_at)
  const workflows = ws.getWorkflows().slice();
  workflows.sort((a, b) => {
    const aOrder = a.sort_order ?? 999;
    const bOrder = b.sort_order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  // Build tool-id → code map for setData scanning
  const SET_DATA_RE = /api\.setData\s*\(\s*['"`]([a-z0-9_]+)['"`]/gi;
  const VAR_REF_RE = /\{\{(?:\[)?\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:\])?\}\}/g;

  const toolCodeMap = new Map<string, string>();
  for (const t of ws.getTools()) {
    if (t.code) toolCodeMap.set(t.tool_id, t.code);
  }

  // dataName → set of workflow_ids that write that data
  const writers = new Map<string, Set<string>>();
  // workflow_id → set of dataNames that workflow reads
  const reads = new Map<string, Set<string>>();

  for (const wf of workflows) {
    const wfReads = new Set<string>();
    for (const n of wf.nodes ?? []) {
      if (n.tool_id && toolCodeMap.has(n.tool_id)) {
        const code = toolCodeMap.get(n.tool_id)!;
        SET_DATA_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SET_DATA_RE.exec(code))) {
          const name = m[1];
          if (!writers.has(name)) writers.set(name, new Set());
          writers.get(name)!.add(wf.id);
        }
      }
      if (n.tool_parameters) {
        for (const val of Object.values(n.tool_parameters)) {
          if (typeof val !== "string") continue;
          VAR_REF_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = VAR_REF_RE.exec(val))) {
            wfReads.add(m[1]);
          }
        }
      }
    }
    if (wfReads.size > 0) reads.set(wf.id, wfReads);
  }

  // Auto-assign depends_on where not explicitly set.
  for (const wf of workflows) {
    if (wf.depends_on && wf.depends_on.length > 0) continue;
    const wfReads = reads.get(wf.id);
    if (!wfReads) continue;
    const deps = new Set<string>();
    for (const name of wfReads) {
      const wset = writers.get(name);
      if (!wset) continue;
      for (const wid of wset) {
        if (wid !== wf.id) deps.add(wid);
      }
    }
    if (deps.size > 0) wf.depends_on = [...deps];
  }

  // Latest session per workflow
  interface SessionFacts {
    status: string;
    completedAt: string | null;
    updatedAt: string;
  }
  const sessionMap = new Map<string, SessionFacts>();
  const sessions = ws.getSessions().slice();
  sessions.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  for (const s of sessions) {
    if (!s.workflow_id) continue;
    if (sessionMap.has(s.workflow_id)) continue;
    const hostInstanceStatus = (s.metadata as any)?.host?.instance_status as string | null | undefined;
    sessionMap.set(s.workflow_id, {
      status: hostInstanceStatus ?? s.status ?? "pending",
      completedAt: s.completed_at ?? null,
      updatedAt: s.updated_at ?? "",
    });
  }

  // Per-data timestamps for staleness detection
  const dataTimestamps = new Map<string, string>();
  for (const name of ws.getDataNames()) {
    const e = ws.getDataEntry(name);
    if (!e) continue;
    const ts = e.edited_at ?? e.loaded_at;
    if (ts) dataTimestamps.set(name, ts);
  }

  // Pre-compute complete + stale sets
  const completedSet = new Set<string>();
  const staleSet = new Set<string>();
  for (const wf of workflows) {
    const session = sessionMap.get(wf.id);
    if (session && (session.status === "completed" || session.status === "awaiting_feedback")) {
      completedSet.add(wf.id);
      const ranAt = session.completedAt || session.updatedAt;
      if (!ranAt) continue;
      const wfReads = reads.get(wf.id);
      if (!wfReads || wfReads.size === 0) continue;
      for (const name of wfReads) {
        const ts = dataTimestamps.get(name);
        if (ts && ts > ranAt) {
          staleSet.add(wf.id);
          break;
        }
      }
    }
  }

  // Cascade staleness through dependencies
  if (staleSet.size > 0) {
    for (const wf of workflows) {
      const dependsOn = wf.depends_on ?? [];
      for (const depId of dependsOn) {
        if (staleSet.has(depId)) {
          staleSet.add(wf.id);
          break;
        }
      }
    }
  }

  // Build status cards
  const cards: WorkflowStatusCard[] = [];
  for (const wf of workflows) {
    const dependsOn = wf.depends_on ?? [];
    const sortOrder = wf.sort_order ?? 999;
    const missingParams: string[] = [];

    const session = sessionMap.get(wf.id);
    let status: WorkflowRunStatus = "not_run";
    let lastRunDate: string | null = null;
    const lastRunSummary: string | null = null;
    const flagCount = 0;

    if (session) {
      lastRunDate = session.completedAt || session.updatedAt;
      if (session.status === "in_progress") {
        status = "running";
      } else if (session.status === "completed" || session.status === "awaiting_feedback") {
        status = staleSet.has(wf.id) ? "stale" : "complete";
      }
    }

    if (status === "not_run") {
      const blockedByNames: string[] = [];
      for (const depId of dependsOn) {
        if (!completedSet.has(depId) || staleSet.has(depId)) {
          const depWf = workflows.find((w) => w.id === depId);
          if (depWf) blockedByNames.push(depWf.name);
        }
      }
      status = blockedByNames.length > 0 || missingParams.length > 0 ? "blocked" : "ready";
    }

    cards.push({
      workflowId: wf.id,
      name: wf.name,
      group: wf.group?.trim() || null,
      sortOrder,
      depthLevel: dependsOn.length > 0 ? 1 : 0,
      dependsOn,
      status,
      lastRunDate,
      lastRunSummary,
      flagCount,
      missingParams,
      blockedBy: dependsOn
        .filter((id) => !completedSet.has(id))
        .map((id) => workflows.find((w) => w.id === id)?.name || id),
    });
  }

  // Compute proper depth levels via dependency traversal
  const idToCard = new Map(cards.map((c) => [c.workflowId, c]));
  function getDepth(id: string, seen: Set<string>): number {
    if (seen.has(id)) return 0;
    seen.add(id);
    const card = idToCard.get(id);
    if (!card || card.dependsOn.length === 0) return 0;
    let max = 0;
    for (const depId of card.dependsOn) {
      max = Math.max(max, getDepth(depId, seen) + 1);
    }
    return max;
  }
  for (const card of cards) {
    card.depthLevel = getDepth(card.workflowId, new Set());
  }

  // Sort by group (ungrouped last), then by name — so the board clusters the
  // "page" workflows under their nav group, alphabetically. "￿" sentinel
  // pushes ungrouped workflows to the bottom.
  cards.sort((a, b) => {
    const ga = a.group ?? "￿";
    const gb = b.group ?? "￿";
    return ga.localeCompare(gb) || a.name.localeCompare(b.name);
  });

  const completedWorkflows = cards.filter((c) => c.status === "complete").length;
  const totalWorkflows = cards.length;
  const progressPercent = totalWorkflows > 0
    ? Math.round((completedWorkflows / totalWorkflows) * 100)
    : 0;

  return {
    period,
    workspaceNotes,
    workflows: cards,
    totalWorkflows,
    completedWorkflows,
    progressPercent,
  };
}

// ── Workspace Notes CRUD ────────────────────────────────────────────────────

export function addWorkspaceNote(databaseId: string, text: string): void {
  const ws = requireSessionByDatabaseId(databaseId);
  const meta = ws.getMetadata();
  const notes = [...(meta.notes ?? [])];
  notes.unshift({ text, created_at: new Date().toISOString() });
  ws.updateMetadata({ notes });
}

export function deleteWorkspaceNote(databaseId: string, index: number): void {
  const ws = requireSessionByDatabaseId(databaseId);
  const meta = ws.getMetadata();
  const notes = [...(meta.notes ?? [])];
  if (index >= 0 && index < notes.length) {
    notes.splice(index, 1);
    ws.updateMetadata({ notes });
  }
}

export function setWorkspacePeriod(databaseId: string, period: string | null): void {
  const ws = requireSessionByDatabaseId(databaseId);
  ws.updateMetadata({ period: period ?? undefined });
}

// ── Workflow Status Reset ────────────────────────────────────────────────────

/**
 * Reset a single workflow's status by clearing its most recent session's
 * completed status. Sets it back to "pending" so it shows as "ready" on
 * the dashboard.
 */
export function resetWorkflowStatus(databaseId: string, workflowId: string): boolean {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return false;
  const sessions = ws.getSessions().filter((s) => s.workflow_id === workflowId);
  if (sessions.length === 0) return false;
  sessions.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const target = sessions[0];
  const hostExtras = ((target.metadata as any)?.host ?? {}) as Record<string, any>;
  ws.upsertSession({
    ...target,
    status: "pending",
    completed_at: undefined,
    metadata: {
      ...(target.metadata as any),
      host: { ...hostExtras, instance_status: "pending" },
    },
  });
  return true;
}

/**
 * Reset all workflow statuses — clears completed/awaiting_feedback status on
 * the most recent session for every workflow.
 */
export function resetAllWorkflowStatuses(databaseId: string): number {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return 0;
  let count = 0;
  for (const wf of ws.getWorkflows()) {
    if (resetWorkflowStatus(databaseId, wf.id)) count++;
  }
  return count;
}
