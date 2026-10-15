/**
 * Workspace State — the deterministic read behind the Overview's "Glass Box" band.
 *
 * Points the Glass Box lens (What · Trust · Next) at the workspace itself instead
 * of at a journal entry. Everything here is DETERMINISTIC: counts come straight
 * from the existing readers, the trust tally is the recorded machine-audit
 * verdicts (binary PASS / NEEDS-REVIEW — never a score, see
 * feedback_no_confidence_scores), and the single "next move" is chosen by a fixed
 * priority ladder (see feedback/project_right_panel_next: the Next CTA is
 * deterministic, not LLM-decided).
 *
 * No HTML is produced here (backend returns data, not markup). The LLM tone line
 * and the generative variant both consume this struct — see glassBoxNarrator.ts.
 */

import { getRecentSessions } from "@backend/core/session/sessions/session_all";
import { listTodos, listInstances, isInstanceOpen } from "@backend/core/workspace/todoStore";
import { listAuditVerdicts } from "@backend/core/knowledge/auditLog";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/** The single deterministic call-to-action. The UI turns this into a real link;
 *  ids only — no URLs invented here (the renderer maps them to existing routes). */
export type NextMove =
  | { kind: "session"; sessionId: string; label: string; reason: string }
  | { kind: "exception"; auditId: string; sessionId: string; label: string; reason: string }
  | { kind: "plan"; todoId: string; instruction: string; label: string; reason: string }
  | { kind: "suggest"; label: string; reason: string };

export interface WorkspaceState {
  workspaceName: string;
  sessions: { total: number; awaitingYou: number; inProgress: number; completed: number };
  plans: { open: number; done: number };
  todoLists: { open: number };
  /** Recorded machine-audit verdicts. Binary, never a score. */
  trust: { verified: number; failed: number; total: number };
  topException: { auditId: string; sessionId: string; subject: string; pack: string } | null;
  next: NextMove;
}

const AWAITING = new Set(["awaiting_feedback", "awaiting_approval"]);
const COMPLETED = new Set(["completed", "satisfied"]);

/**
 * Read the active workspace into one struct. Safe when no session is open
 * (every reader returns empty) — yields a zeroed, "suggest a task" state.
 */
export async function assembleWorkspaceState(databaseId: string): Promise<WorkspaceState> {
  const ws = getSessionByDatabaseId(databaseId);
  const workspaceName = ws ? ws.getWorkspaceName() : "Workspace";

  // ── Sessions ──────────────────────────────────────────────────────────────
  const sessions = getRecentSessions(databaseId, 500);
  let awaitingYou = 0;
  let inProgress = 0;
  let completed = 0;
  let firstAwaiting: { id: string; label: string } | null = null;
  for (const s of sessions) {
    if (AWAITING.has(s.instance_status)) {
      awaitingYou++;
      if (!firstAwaiting) {
        firstAwaiting = { id: s.session_id, label: s.first_message || s.session_name || "your chat" };
      }
    } else if (s.instance_status === "in_progress") {
      inProgress++;
    } else if (COMPLETED.has(s.instance_status)) {
      completed++;
    }
  }

  // ── Plans (from the .wfp `plan` node; drafts + skipped are not shown) ──────
  const planEntries = ws ? ws.getPlan().filter(
    (t: any) => t.status !== "skipped" && t.status !== "draft" && t.status !== "cancelled",
  ) : [];
  const plansOpen = planEntries.filter((t: any) => t.status === "pending" || t.status === "in_progress");
  const plansDone = planEntries.filter((t: any) => t.status === "done").length;

  // ── Enterprise todo lists that are still open ──────────────────────────────
  const openTodoLists = listInstances(databaseId).filter((i) =>
    isInstanceOpen(databaseId, i.instanceName),
  ).length;

  // ── Trust (recorded machine-audit verdicts; needs-review sorted first) ─────
  const verdicts = await listAuditVerdicts(databaseId);
  const verified = verdicts.filter((v) => v.verdict === "pass").length;
  const failedCount = verdicts.filter((v) => v.verdict === "failed").length;
  const topV = verdicts.find((v) => v.verdict === "failed") ?? null;
  const topException = topV
    ? {
        auditId: topV.auditId,
        sessionId: topV.sessionId,
        subject: topV.subject || topV.pack || "an allocation",
        pack: topV.pack,
      }
    : null;

  // ── Next move — fixed priority ladder (deterministic, not LLM-decided) ──────
  // 1) a chat waiting on you  2) a flagged audit  3) your next plan step
  // 4) nothing → invite a new task.
  let next: NextMove;
  if (firstAwaiting) {
    next = {
      kind: "session",
      sessionId: firstAwaiting.id,
      label: firstAwaiting.label,
      reason: "A chat is waiting on your reply.",
    };
  } else if (topException) {
    next = {
      kind: "exception",
      auditId: topException.auditId,
      sessionId: topException.sessionId,
      label: topException.subject,
      reason: "A machine audit flagged this for review.",
    };
  } else if (plansOpen.length > 0) {
    const t = plansOpen[0];
    next = {
      kind: "plan",
      todoId: t.id ?? "",
      instruction: t.instruction,
      label: t.label,
      reason: "Your next planned step.",
    };
  } else {
    next = {
      kind: "suggest",
      label: "Describe a task to get started",
      reason: "Everything is clear.",
    };
  }

  return {
    workspaceName,
    sessions: { total: sessions.length, awaitingYou, inProgress, completed },
    plans: { open: plansOpen.length, done: plansDone },
    todoLists: { open: openTodoLists },
    trust: { verified, failed: failedCount, total: verdicts.length },
    topException,
    next,
  };
}

/**
 * Small stable fingerprint of the meaningful state (FNV-1a over JSON). Used as a
 * cache key so the one LLM tone line is reused until the state actually changes —
 * an SSE tick that doesn't move any number costs zero tokens.
 */
export function stateHash(s: WorkspaceState): string {
  const json = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
