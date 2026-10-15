// Per-workflow undo snapshots — in-memory (module-level, not persisted).
import { v4 as uuidv4 } from "uuid";
import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

const MAX_VERSIONS = 10;

interface VersionEntry {
  version_id: string;
  label: string;
  created_at: string;
  nodes: string;
}

const store = new Map<string, VersionEntry[]>();

function key(databaseId: string, workflowId: string): string {
  return `${databaseId}::${workflowId}`;
}

function getVersions(databaseId: string, workflowId: string): VersionEntry[] {
  return store.get(key(databaseId, workflowId)) ?? [];
}

function setVersions(databaseId: string, workflowId: string, versions: VersionEntry[]): void {
  store.set(key(databaseId, workflowId), versions);
}

export const snapshotWorkflow = async (
  databaseId: string,
  workflowId: string,
  label: string,
): Promise<void> => {
  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return;

  const versions = getVersions(databaseId, workflowId);
  versions.unshift({
    version_id: uuidv4(),
    label,
    created_at: new Date().toISOString(),
    nodes: JSON.stringify(wf.nodes),
  });
  if (versions.length > MAX_VERSIONS) versions.length = MAX_VERSIONS;
  setVersions(databaseId, workflowId, versions);
};

export const getWorkflowVersions = (
  databaseId: string,
  workflowId: string,
): Array<{ version_id: string; label: string; created_at: string }> => {
  return getVersions(databaseId, workflowId).map((v) => ({
    version_id: v.version_id,
    label: v.label,
    created_at: v.created_at,
  }));
};

export const restoreWorkflowVersion = (
  databaseId: string,
  workflowId: string,
  versionId: string,
): boolean => {
  const versions = getVersions(databaseId, workflowId);
  const version = versions.find((v) => v.version_id === versionId);
  if (!version) return false;

  const session = requireSessionByDatabaseId(databaseId);
  const wf = session.getWorkflow(workflowId);
  if (!wf) return false;

  const nodes = JSON.parse(version.nodes || "[]");
  session.upsertWorkflow({
    ...wf,
    nodes,
    updated_at: new Date().toISOString(),
  });
  return true;
};
