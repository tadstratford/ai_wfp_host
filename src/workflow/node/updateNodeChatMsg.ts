import type { WorkflowMgmt_ChatMsg } from "@backend/types";
import { patchNode } from "./_helpers";

/** Update a node's chat message settings. */
export const updateNodeChatMsg = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  chatMsg: WorkflowMgmt_ChatMsg,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    workflow_mgmt: { ...node.workflow_mgmt, ...chatMsg },
  }));
};
