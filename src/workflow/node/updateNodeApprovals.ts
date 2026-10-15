import type { WorkflowMgmt_Approvals } from "@backend/types";
import { patchNode } from "./_helpers";

/** Update a node's approval and staff settings. */
export const updateNodeApprovals = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  approvals: WorkflowMgmt_Approvals,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    workflow_mgmt: { ...node.workflow_mgmt, ...approvals },
  }));
};
