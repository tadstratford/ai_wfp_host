// workflowIndex — plaintext cache of workspace → workflow names, stored in the
// `workspace_workflows` Supabase table (schema/supabase-schema.sql). Lets the
// Home page list every workspace's workflows by name without opening
// (decrypting) the workspace blob. Kept in sync on every save/create by
// workspaceStore; replaced wholesale (a few rows) with a RAM signature guard so
// autosaves don't re-write unchanged workflow lists.

import * as db from "../server/admin/supabase";

const TABLE = "workspace_workflows";

const COLS = "workspace_id,workflow_id,name,group_name,updated_at";

export interface WorkflowIndexInput {
  id: string;
  name: string;
  group?: string;
  updated_at?: string;
}

export interface WorkflowIndexEntry {
  workflowId: string;
  name: string;
  group: string | null;
  updatedAt: string | null;
}

interface WorkflowRow {
  workspace_id: string;
  workflow_id: string;
  name: string;
  group_name: string | null;
  updated_at: string | null;
}

// Process-local guard so autosave (debounced on every mutation) doesn't hit
// Supabase with identical workflow lists on every flush.
const lastSignature = new Map<string, string>();

function signature(workflows: WorkflowIndexInput[]): string {
  return workflows
    .map((w) => `${w.id}|${w.name}|${w.group ?? ""}`)
    .sort()
    .join("\n");
}

/** Replace a workspace's cached workflow list with the current set. No-op when
 *  unchanged since the last sync (id/name/group signature). Swallows the
 *  23503 FK error (no `workspaces` row — disk/memory-backed). */
export async function syncWorkspaceWorkflows(
  workspaceId: string,
  workflows: WorkflowIndexInput[],
): Promise<void> {
  const sig = signature(workflows);
  if (lastSignature.get(workspaceId) === sig) return;

  await db.del(TABLE, { workspace_id: workspaceId });

  if (workflows.length > 0) {
    const rows: WorkflowRow[] = workflows.map((w) => ({
      workspace_id: workspaceId,
      workflow_id: w.id,
      name: w.name,
      group_name: w.group?.trim() || null,
      updated_at: w.updated_at ?? null,
    }));
    const result = await db.insert(TABLE, rows);
    if (result.error && !result.error.includes("23503")) {
      console.error(`[workflowIndex] insert failed for ${workspaceId}:`, result.error);
      return;
    }
  }

  lastSignature.set(workspaceId, sig);
}

/** Read cached workflow names for a set of workspaces, keyed by workspace_id. */
export async function listWorkspaceWorkflows(
  workspaceIds: string[],
): Promise<Map<string, WorkflowIndexEntry[]>> {
  const out = new Map<string, WorkflowIndexEntry[]>();
  for (const id of workspaceIds) {
    const result = await db.select<WorkflowRow>(TABLE, { workspace_id: id }, COLS);
    out.set(
      id,
      (result.data ?? []).map((r) => ({
        workflowId: r.workflow_id,
        name: r.name,
        group: r.group_name,
        updatedAt: r.updated_at,
      })),
    );
  }
  return out;
}
