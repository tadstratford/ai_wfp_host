import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkflowNode } from "@backend/types";

/**
 * Updates the position of a single workflow node.
 * x/y are host-only UI extras, not in the .wfp 1.0.0 Node spec, so we cast.
 */
export const updateNodePosition = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  x: number,
  y: number,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const idx = wf.nodes.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;

  const nodes = [...wf.nodes] as WorkflowNode[];
  nodes[idx] = { ...nodes[idx], x, y } as any;

  session.upsertWorkflow({
    ...wf,
    nodes,
    updated_at: new Date().toISOString(),
  });
  return true;
};
