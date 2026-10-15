// Shared helpers for per-node mutations.
//
// Each update handler in this directory loads a workflow from the active
// WorkspaceSession, mutates one node, and writes the workflow back. This
// helper centralises that pattern.

import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkflowNode } from "@backend/types";

/**
 * Apply `patch` to the node identified by `nodeId` in `workflowId` and save.
 * Returns true if the node was found and updated.
 */
export function patchNode(
  databaseId: string,
  workflowId: string,
  nodeId: string,
  patch: (node: WorkflowNode) => WorkflowNode,
): boolean {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const idx = wf.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;

  const nodes = [...wf.nodes];
  nodes[idx] = patch(nodes[idx]);

  session.upsertWorkflow({
    ...wf,
    nodes,
    updated_at: new Date().toISOString(),
  });
  return true;
}
