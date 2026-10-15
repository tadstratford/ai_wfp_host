import type { WorkflowMgmt_Budget } from "@backend/types";
import { patchNode } from "./_helpers";

/** Update a node's budget and time tracking settings. */
export const updateNodeBudget = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  budget: WorkflowMgmt_Budget,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    workflow_mgmt: { ...node.workflow_mgmt, ...budget },
  }));
};
