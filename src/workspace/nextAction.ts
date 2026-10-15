/**
 * Next Action — deterministic picker for the right-panel CTA.
 *
 * Reads workspace state (workflow status, todos, data files) and returns
 * a single recommended next step. Designed around the engagement ladder:
 * always nudge the user one rung up (Trying → Completing → Repeating → ...).
 *
 * No LLM call. Cheap to compute on every right-panel render.
 */

import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getWorkspaceStatus } from "./workflowStatus";
import { listTodos } from "./todoStore";

export type NextActionKind =
  | "empty"        // brand-new workspace
  | "load-data"    // workspace has nothing useful to act on
  | "describe"     // data is loaded but no workflows exist
  | "running"      // a workflow session is in_progress
  | "stale"        // a previously-completed workflow needs to rerun
  | "ready"        // a workflow is built but has never run
  | "todo"         // a pending todo is the most useful next step
  | "done"         // every workflow is complete — invite the next thing
  | "ask";         // generic fallback

export interface NextAction {
  kind: NextActionKind;
  message: string;       // one short line, may include **bold**
  actionLabel: string;   // CTA button text
  /** hx-get target — always swapped into #main-panel. */
  href: string;
}

export function getNextAction(databaseId: string): NextAction {
  const status = getWorkspaceStatus(databaseId);
  const pendingTodos = listTodos(databaseId, { status: "pending" });

  const ws = getSessionByDatabaseId(databaseId);
  const dataCount = ws ? ws.getDataNames().length : 0;

  const totalWf = status.workflows.length;
  const running = status.workflows.find((w) => w.status === "running");
  const stale = status.workflows.find((w) => w.status === "stale");
  const ready = status.workflows.find((w) => w.status === "ready");

  // Brand-new workspace: nothing anywhere.
  if (dataCount === 0 && totalWf === 0 && pendingTodos.length === 0) {
    return {
      kind: "empty",
      message: "Fresh workspace. Load some data, or describe what you want to do.",
      actionLabel: "Load data",
      href: "/app/data",
    };
  }

  // Something is actively running — point at it.
  if (running) {
    return {
      kind: "running",
      message: `**${running.name}** is running.`,
      actionLabel: "Open session",
      href: `/app/session?workflow_id=${running.workflowId}&action=run`,
    };
  }

  // Stale workflow needs to rerun against fresh data.
  if (stale) {
    return {
      kind: "stale",
      message: `**${stale.name}** is stale — rerun to pick up the latest data.`,
      actionLabel: `Run ${stale.name}`,
      href: `/app/session?workflow_id=${stale.workflowId}&action=run`,
    };
  }

  // First-run nudge: workflow built but never executed.
  if (ready) {
    return {
      kind: "ready",
      message: `**${ready.name}** is ready to run.`,
      actionLabel: `Run ${ready.name}`,
      href: `/app/session?workflow_id=${ready.workflowId}&action=run`,
    };
  }

  // Data is loaded but no workflows yet — describe → build.
  if (dataCount > 0 && totalWf === 0) {
    return {
      kind: "describe",
      message: "Data is loaded. Describe what you want to do with it.",
      actionLabel: "Build a workflow",
      href: `/app/session?action=new&prefill=${encodeURIComponent("/wf-build ")}`,
    };
  }

  // No data, but planner todos or other state exists — fall through to todos.
  if (dataCount === 0 && totalWf === 0) {
    if (pendingTodos.length > 0) {
      const top = pendingTodos[0];
      return {
        kind: "todo",
        message: `Next: **${top.label}**.`,
        actionLabel: "Start",
        href: `/app/session?action=new&prefill=${encodeURIComponent(top.instruction)}&todo_id=${top.todoId}`,
      };
    }
    return {
      kind: "load-data",
      message: "Add data to get started.",
      actionLabel: "Load data",
      href: "/app/data",
    };
  }

  // Top pending todo wins over generic "done".
  if (pendingTodos.length > 0) {
    const top = pendingTodos[0];
    return {
      kind: "todo",
      message: `Next: **${top.label}**.`,
      actionLabel: "Start",
      href: `/app/session?action=new&prefill=${encodeURIComponent(top.instruction)}&todo_id=${top.todoId}`,
    };
  }

  // Everything's done. Invite the next thing.
  if (totalWf > 0 && status.completedWorkflows === totalWf) {
    return {
      kind: "done",
      message: "All workflows complete. Ask about your data, or build the next one.",
      actionLabel: "Ask",
      href: `/app/session?action=new&prefill=${encodeURIComponent("/ask ")}`,
    };
  }

  // Generic fallback.
  return {
    kind: "ask",
    message: "Ask about your data, or build a new workflow.",
    actionLabel: "Ask",
    href: `/app/session?action=new&prefill=${encodeURIComponent("/ask ")}`,
  };
}
