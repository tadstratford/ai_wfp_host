import { patchNode } from "./_helpers";

/** Update a node's label/name. */
export const updateNodeName = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  label: string,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({ ...node, label }));
};
