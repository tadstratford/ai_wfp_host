import { patchNode } from "./_helpers";

/** Update a node's runtime parameters (tool_parameters). */
export const updateNodeParameters = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  tool_parameters: Record<string, any>,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    tool_parameters: { ...node.tool_parameters, ...tool_parameters },
  }));
};
