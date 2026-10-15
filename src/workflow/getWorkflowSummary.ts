import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

/** Lightweight fetch — returns name, description, and summary. */
export const getWorkflowSummary = (
  databaseId: string,
  workflowId: string,
): { name: string; description: string; summary: string | null } | null => {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return null;
  const wf = session.getWorkflow(workflowId);
  if (!wf) return null;
  return {
    name: wf.name,
    description: wf.description ?? "",
    summary: wf.summary ?? null,
  };
};
