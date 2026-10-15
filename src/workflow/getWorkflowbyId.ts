import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { Workflow } from "@backend/types";

export const getWorkflowById = async (
  databaseId: string,
  workflow_id: string
): Promise<Workflow | null> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflow_id);
  if (!wf) {
    const all = session.getWorkflows().map((w) => w.id).join(", ");
    console.warn(
      `[getWorkflowById] not found. databaseId=${databaseId} requested=${workflow_id} actual ids=[${all}]`,
    );
    return null;
  }

  // Backward compat: if any node lacks step_order, assign from position
  const nodes = [...(wf.nodes ?? [])];
  const needsStepOrder = nodes.some((n: any) => n.step_order == null);
  if (needsStepOrder && nodes.length > 0) {
    const { assignStepOrder } = await import("./graphWorkflow");
    const ordered = assignStepOrder(nodes);
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].step_order = ordered[i].step_order;
    }
  }

  return {
    ...wf,
    nodes,
  };
};
