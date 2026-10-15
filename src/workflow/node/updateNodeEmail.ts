import type { WorkflowMgmt_Email } from "@backend/types";
import { patchNode } from "./_helpers";

/** Update a node's email integration settings. */
export const updateNodeEmail = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  email: WorkflowMgmt_Email,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    workflow_mgmt: { ...node.workflow_mgmt, ...email },
  }));
};
