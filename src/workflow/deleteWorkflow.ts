import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export const deleteWorkflow = async (
  databaseId: string,
  workflow_id: string,
): Promise<boolean> => {
  const session = requireSessionByDatabaseId(databaseId);
  const target = session.getWorkflow(workflow_id);
  if (!target) return false;

  session.deleteWorkflow(workflow_id);

  return true;
};
