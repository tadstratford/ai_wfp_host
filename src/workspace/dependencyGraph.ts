/**
 * Workflow Dependency Graph
 *
 * Manages the DAG of workflow dependencies and handles:
 * - Setting/updating dependencies between workflows
 * - Computing execution order (topological sort)
 * - Determining which workflows are stale after upstream re-runs
 * - Marking downstream workflows for re-execution
 *
 * Post-M11g: all reads/writes go through the active WorkspaceSession.
 */

import { requireSessionByDatabaseId, getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkflowDep {
  workflowId: string;
  name: string;
  dependsOn: string[];
  sortOrder: number;
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Set the depends_on and sort_order for a workflow.
 */
export function setWorkflowDependencies(
  databaseId: string,
  workflowId: string,
  dependsOn: string[],
  sortOrder?: number,
): void {
  const ws = requireSessionByDatabaseId(databaseId);
  const wf = ws.getWorkflow(workflowId);
  if (!wf) return;
  ws.upsertWorkflow({
    ...wf,
    depends_on: dependsOn.length > 0 ? [...dependsOn] : undefined,
    sort_order: sortOrder !== undefined ? sortOrder : wf.sort_order,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Get all workflows with their dependencies.
 */
export function getWorkflowGraph(databaseId: string): WorkflowDep[] {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  const workflows = ws.getWorkflows().slice();
  workflows.sort((a, b) => {
    const aOrder = a.sort_order ?? 999;
    const bOrder = b.sort_order ?? 999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
  return workflows.map((w) => ({
    workflowId: w.id,
    name: w.name,
    dependsOn: w.depends_on ?? [],
    sortOrder: w.sort_order ?? 999,
  }));
}

/**
 * Get the topological execution order for all workflows.
 * Returns workflow IDs in an order where dependencies come before dependents.
 */
export function getExecutionOrder(databaseId: string): string[] {
  const graph = getWorkflowGraph(databaseId);
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const idToNode = new Map(graph.map((g) => [g.workflowId, g]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle — skip to prevent infinite loop
    visiting.add(id);

    const node = idToNode.get(id);
    if (node) {
      for (const depId of node.dependsOn) {
        visit(depId);
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const node of graph) {
    visit(node.workflowId);
  }
  return order;
}

/**
 * Find all downstream workflows affected by a change to a given workflow.
 */
export function getDownstreamWorkflows(
  databaseId: string,
  workflowId: string,
): string[] {
  const graph = getWorkflowGraph(databaseId);

  const dependents = new Map<string, string[]>();
  for (const node of graph) {
    for (const depId of node.dependsOn) {
      if (!dependents.has(depId)) dependents.set(depId, []);
      dependents.get(depId)!.push(node.workflowId);
    }
  }

  const downstream: string[] = [];
  const visited = new Set<string>();
  const queue = [workflowId];
  visited.add(workflowId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = dependents.get(current) || [];
    for (const depId of deps) {
      if (!visited.has(depId)) {
        visited.add(depId);
        downstream.push(depId);
        queue.push(depId);
      }
    }
  }
  return downstream;
}

/**
 * When a workflow is re-run, find all downstream workflows that should be
 * marked stale.
 */
export function getStaleWorkflows(
  databaseId: string,
  rerunWorkflowId: string,
): Array<{ workflowId: string; name: string }> {
  const downstreamIds = getDownstreamWorkflows(databaseId, rerunWorkflowId);
  if (downstreamIds.length === 0) return [];

  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  const results: Array<{ workflowId: string; name: string }> = [];
  for (const id of downstreamIds) {
    const wf = ws.getWorkflow(id);
    if (wf) results.push({ workflowId: wf.id, name: wf.name });
  }
  return results;
}

/**
 * Auto-assign sort_order to workflows based on their dependency depth.
 */
export function autoAssignSortOrder(databaseId: string): void {
  const ws = requireSessionByDatabaseId(databaseId);
  const graph = getWorkflowGraph(databaseId);

  const depths = new Map<string, number>();
  const idToNode = new Map(graph.map((g) => [g.workflowId, g]));

  function getDepth(id: string, seen: Set<string>): number {
    if (depths.has(id)) return depths.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);

    const node = idToNode.get(id);
    if (!node || node.dependsOn.length === 0) {
      depths.set(id, 0);
      return 0;
    }
    let maxDepth = 0;
    for (const depId of node.dependsOn) {
      maxDepth = Math.max(maxDepth, getDepth(depId, seen) + 1);
    }
    depths.set(id, maxDepth);
    return maxDepth;
  }

  for (const node of graph) {
    getDepth(node.workflowId, new Set());
  }

  for (const [id, depth] of depths.entries()) {
    const wf = ws.getWorkflow(id);
    if (!wf) continue;
    ws.upsertWorkflow({ ...wf, sort_order: depth, updated_at: new Date().toISOString() });
  }
}
