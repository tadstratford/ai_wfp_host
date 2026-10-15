import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { Workflow, WorkflowNode } from "@backend/types";

export const updateWorkflow = async (
  databaseId: string,
  workflow_id: string,
  name: string,
  description: string,
  nodes: WorkflowNode[],
): Promise<Workflow | null> => {
  const session = requireSessionByDatabaseId(databaseId);
  const existing = session.getWorkflow(workflow_id);
  if (!existing) return null;

  const nowIso = new Date().toISOString();
  const updated: Workflow = {
    ...existing,
    id: workflow_id,
    name,
    description,
    nodes,
    updated_at: nowIso,
  };
  session.upsertWorkflow(updated);
  return updated;
};
