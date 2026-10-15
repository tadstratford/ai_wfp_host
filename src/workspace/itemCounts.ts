import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export interface WorkspaceItemCounts {
  workflows: number;
  customTools: number;
  sessions: number;
  dataFiles: number;
}

export interface ChangelogEntry {
  workflow: string;
  entry: string;
}

/** Get recent changelog entries across all workflows. */
export const getWorkspaceChangelog = (
  databaseId: string,
  limit: number = 10,
): ChangelogEntry[] => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return [];
  // Newest first by updated_at
  const workflows = ws
    .getWorkflows()
    .slice()
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

  const entries: ChangelogEntry[] = [];
  for (const wf of workflows) {
    if (!wf.description) continue;
    const changelogIdx = wf.description.indexOf("## Changelog");
    if (changelogIdx === -1) continue;
    const changelogSection = wf.description.slice(changelogIdx + "## Changelog".length).trim();
    const lines = changelogSection.split("\n").filter((l) => l.startsWith("- ")).slice(0, 5);
    for (const line of lines) {
      entries.push({ workflow: wf.name, entry: line.slice(2).trim() });
    }
  }
  return entries.slice(0, limit);
};

/** Get counts of all item types in the active workspace. */
export const getWorkspaceItemCounts = (databaseId: string): WorkspaceItemCounts => {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) {
    return { workflows: 0, customTools: 0, sessions: 0, dataFiles: 0 };
  }
  return {
    workflows: ws.getWorkflows().length,
    customTools: ws.getTools().length,
    sessions: ws.getSessions().length,
    dataFiles: ws.getDataNames().length,
  };
};
