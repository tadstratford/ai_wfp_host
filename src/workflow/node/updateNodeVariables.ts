import { patchNode } from "./_helpers";

/**
 * Update a node's variables. Stored in tool_config; merged into
 * session.parameters when the node runs.
 */
export const updateNodeVariables = async (
  databaseId: string,
  workflowId: string,
  nodeId: string,
  variables: Record<string, any>,
): Promise<boolean> => {
  return patchNode(databaseId, workflowId, nodeId, (node) => ({
    ...node,
    tool_config: { ...(node.tool_config || {}), ...variables },
  }));
};
