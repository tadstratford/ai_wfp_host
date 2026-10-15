import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { Workflow, WorkflowNode } from "@backend/types";
import { snapshotWorkflow } from "./workflowVersions";
import { generateWorkflowSummary } from "@backend/core/context/summarize";

// ---------------------------------------------------------------------------
// Linear ordering helpers
// ---------------------------------------------------------------------------

/**
 * Sort nodes into linear execution order:
 * Start node first, End node last, everything else by step_order.
 */
export function getLinearOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  const start = nodes.filter((n) => n.type === "start" || n.tool_id === "workflow_start");
  const end = nodes.filter((n) => n.type === "end" || n.tool_id === "workflow_end");
  const middle = nodes.filter(
    (n) =>
      !(n.type === "start" || n.tool_id === "workflow_start") &&
      !(n.type === "end" || n.tool_id === "workflow_end"),
  );
  middle.sort((a, b) => (a.step_order ?? 9999) - (b.step_order ?? 9999));
  return [...start, ...middle, ...end];
}

/**
 * Assign step_order from linear position.
 * Start pinned first, End pinned last, middle nodes keep their array order.
 */
export function assignStepOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  const start = nodes.filter((n) => n.type === "start" || n.tool_id === "workflow_start");
  const end = nodes.filter((n) => n.type === "end" || n.tool_id === "workflow_end");
  const middle = nodes.filter(
    (n) =>
      !(n.type === "start" || n.tool_id === "workflow_start") &&
      !(n.type === "end" || n.tool_id === "workflow_end"),
  );
  const ordered = [...start, ...middle, ...end];
  return ordered.map((node, i) => ({ ...node, step_order: i + 1 }));
}

// ---------------------------------------------------------------------------
// Mutations through WorkspaceSession
// ---------------------------------------------------------------------------

function saveNodes(databaseId: string, workflowId: string, nodes: WorkflowNode[]): boolean {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;
  session.upsertWorkflow({
    ...wf,
    nodes,
    updated_at: new Date().toISOString(),
  });
  return true;
}

async function refreshWorkflowSummary(databaseId: string, workflowId: string): Promise<void> {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return;
  const nodeSlice = wf.nodes.map((n) => ({ tool_id: n.tool_id ?? "", label: n.label ?? "" }));
  generateWorkflowSummary(databaseId, workflowId, wf.name ?? "Untitled", nodeSlice).catch(() => {});
}

/**
 * Reorder nodes by an ordered array of node_ids, reassign step_order, and save.
 */
export async function reorderWorkflowNodes(
  databaseId: string,
  workflowId: string,
  orderedNodeIds: string[],
): Promise<boolean> {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const nodeMap = new Map(wf.nodes.map((n) => [n.id, n]));
  const reordered: WorkflowNode[] = [];
  for (const id of orderedNodeIds) {
    const node = nodeMap.get(id);
    if (node) {
      reordered.push(node);
      nodeMap.delete(id);
    }
  }
  for (const node of nodeMap.values()) {
    reordered.push(node);
  }

  const ok = saveNodes(databaseId, workflowId, assignStepOrder(reordered));
  if (ok) await refreshWorkflowSummary(databaseId, workflowId);
  return ok;
}

export const addWorkflowNode = async (
  databaseId: string,
  workflowId: string,
  node: WorkflowNode,
): Promise<void> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);

  const nodes = [...wf.nodes, node];
  saveNodes(databaseId, workflowId, assignStepOrder(nodes));
  refreshWorkflowSummary(databaseId, workflowId);
};

export const updateWorkflowNode = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  updates: Partial<WorkflowNode>,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const idx = wf.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;

  const nodes = [...wf.nodes];
  nodes[idx] = { ...nodes[idx], ...updates };
  return saveNodes(databaseId, workflowId, nodes);
};

export const removeWorkflowNode = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const nodeBeingDeleted = wf.nodes.find((n) => n.id === nodeId);
  await snapshotWorkflow(
    databaseId,
    workflowId,
    `Before deleting '${nodeBeingDeleted?.label ?? nodeId}'`,
  );

  const filtered = wf.nodes.filter((n) => n.id !== nodeId);
  if (filtered.length === wf.nodes.length) return false;

  const ok = saveNodes(databaseId, workflowId, assignStepOrder(filtered));
  if (ok) await refreshWorkflowSummary(databaseId, workflowId);
  return ok;
};

export const updateNodePositions = async (
  databaseId: string,
  workflowId: string,
  positions: Record<string, { x: number; y: number }>,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const nodes = wf.nodes.map((node) => {
    if (positions[node.id]) {
      return { ...node, x: positions[node.id].x, y: positions[node.id].y } as any;
    }
    return node;
  });
  return saveNodes(databaseId, workflowId, nodes);
};
