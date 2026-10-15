import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkflowNode } from "@backend/types";
import { assignStepOrder } from "../graphWorkflow";
import { generateWorkflowSummary } from "@backend/core/context/summarize";

/**
 * Insert a new node into the workflow. The node is appended before the End
 * node (or at the end if no End node). Step order is reassigned from the
 * linear position.
 */
export const spliceNewNode = async (
  databaseId: string,
  workflowId: string,
  newNode: WorkflowNode,
): Promise<WorkflowNode | null> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) throw new Error(`Workflow ${workflowId} not found`);

  const nodes = [...wf.nodes];
  const endIndex = nodes.findIndex(
    (n) => n.type === "end" || n.tool_id === "workflow_end",
  );
  if (endIndex >= 0) {
    nodes.splice(endIndex, 0, newNode);
  } else {
    nodes.push(newNode);
  }
  const updatedNodes = assignStepOrder(nodes);

  session.upsertWorkflow({
    ...wf,
    nodes: updatedNodes,
    updated_at: new Date().toISOString(),
  });

  const nodeSlice = updatedNodes.map((n) => ({
    tool_id: n.tool_id ?? "",
    label: n.label ?? "",
  }));
  generateWorkflowSummary(databaseId, workflowId, wf.name ?? "Untitled", nodeSlice).catch(
    () => {},
  );

  return newNode;
};
