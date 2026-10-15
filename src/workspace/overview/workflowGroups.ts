/**
 * Workflow Group Derivation
 *
 * Groups workflows by their free-text `workflow.group` field (passive config —
 * typed on each workflow card; persists on the Workflow node in the .wfp
 * document). Replaces the prior listInstances/instanceName model with a simpler
 * one that needs no extra UI to manage.
 *
 * Output: groups in alphabetical order, "(Ungrouped)" always last. Within a
 * group, workflows sorted by sortOrder then name. Status counts and a
 * `canReset` flag drive the per-group Reset button.
 */

import {
  getWorkspaceStatus,
  type WorkflowStatusCard,
} from "@backend/core/workspace/workflowStatus";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowGroup {
  /** Free-text group label as typed on the workflow card, or "(Ungrouped)". */
  name: string;
  /** True for the synthetic "(Ungrouped)" bucket — never a user-named group. */
  isUngrouped: boolean;
  /** Workflows in this group, sorted by sortOrder then name. */
  workflows: WorkflowStatusCard[];
  total: number;
  /** Count of workflows with status === "complete". */
  completed: number;
  /** Count of workflows with status === "running" or "in_progress". */
  inProgress: number;
  /** Any workflow in the group is complete/stale — Reset is meaningful. */
  canReset: boolean;
}

const UNGROUPED = "(Ungrouped)";

// ── Main function ────────────────────────────────────────────────────────────

export function getWorkflowGroups(databaseId: string): WorkflowGroup[] {
  const status = getWorkspaceStatus(databaseId);
  const byGroup = new Map<string, WorkflowStatusCard[]>();
  for (const wf of status.workflows) {
    const key = wf.group?.trim() || UNGROUPED;
    const arr = byGroup.get(key) ?? [];
    arr.push(wf);
    byGroup.set(key, arr);
  }

  const out: WorkflowGroup[] = [];
  for (const [name, workflows] of byGroup) {
    workflows.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    const completed = workflows.filter((w) => w.status === "complete").length;
    const inProgress = workflows.filter(
      (w) => w.status === "running",
    ).length;
    const canReset = workflows.some(
      (w) => w.status === "complete" || w.status === "stale",
    );
    out.push({
      name,
      isUngrouped: name === UNGROUPED,
      workflows,
      total: workflows.length,
      completed,
      inProgress,
      canReset,
    });
  }

  // Alphabetical, "(Ungrouped)" last.
  out.sort((a, b) => {
    if (a.isUngrouped) return 1;
    if (b.isUngrouped) return -1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** All workflow ids belonging to one named group (or "(Ungrouped)" for the
 *  synthetic bucket). Used by the group-level Reset handler. */
export function getWorkflowIdsInGroup(
  databaseId: string,
  groupName: string,
): string[] {
  const groups = getWorkflowGroups(databaseId);
  const g = groups.find((x) => x.name === groupName);
  return g ? g.workflows.map((w) => w.workflowId) : [];
}
