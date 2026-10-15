import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { Workflow } from "@backend/types/workflowTypes";

export const getWorkflows = async (databaseId: string): Promise<Workflow[]> => {
  if (!databaseId) {
    console.warn("⚠️ [Workflows] No database ID provided - returning empty workflow list");
    return [];
  }
  const session = getSessionByDatabaseId(databaseId);
  if (!session) {
    console.warn(`⚠️ [Workflows] No workspace session open for databaseId=${databaseId}`);
    return [];
  }
  // Sort by name to match the previous SQL ORDER BY name.
  return session.getWorkflows().sort((a, b) => a.name.localeCompare(b.name)) as Workflow[];
};
