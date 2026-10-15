// workflowGrants — server-readable access grants for shared workflows.
//
// A grant lets one other user (by email) view a SINGLE workflow from the
// owner's encrypted workspace, read-only. Grants are the source of truth for
// access: revoke = delete the row. The owner's workspace secret is still
// required to decrypt — the grant only authorizes the fetch, it does not store
// the secret. See docs/wfp-lifecycle-redesign.md §7.
//
// Denormalized on purpose (owner_email, workflow_name) so the eq-only Supabase
// REST wrapper can render lists without joins.

import { randomUUID } from "node:crypto";
import type { Session, Tool, WfpFile, Workflow } from "wfp-format";
import * as db from "../server/admin/supabase";

// Renamed from workflow_grants → workspace_grants (whole-workspace sharing);
// see migrations/rename_workflow_grants_to_workspace_grants.sql.
const TABLE = "workspace_grants";

const COLS =
  "grant_id,workspace_id,workflow_id,workflow_name,owner_user_id,owner_email," +
  "grantee_email,grantee_user_id,created_at,last_accessed_at,access_count";

export interface GrantRow {
  grant_id: string;
  workspace_id: string;
  workflow_id: string;
  workflow_name: string;
  owner_user_id: string;
  owner_email: string;
  grantee_email: string;
  grantee_user_id: string | null;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Create / list / revoke ──────────────────────────────────────────────────

export interface CreateGrantArgs {
  workspaceId: string;
  workflowId: string;
  workflowName: string;
  ownerUserId: string;
  ownerEmail: string;
  granteeEmail: string;
}

export async function createGrant(args: CreateGrantArgs): Promise<GrantRow> {
  const row: GrantRow = {
    grant_id: randomUUID(),
    workspace_id: args.workspaceId,
    workflow_id: args.workflowId,
    workflow_name: args.workflowName,
    owner_user_id: args.ownerUserId,
    owner_email: normalizeEmail(args.ownerEmail),
    grantee_email: normalizeEmail(args.granteeEmail),
    grantee_user_id: null,
    created_at: new Date().toISOString(),
    last_accessed_at: null,
    access_count: 0,
  };
  const result = await db.insert(TABLE, row);
  if (result.error) {
    throw new Error(`Failed to create grant: ${result.error}`);
  }
  return row;
}

/** Grants on a specific workflow (for the owner's Share modal). */
export async function listGrantsForWorkflow(
  workspaceId: string,
  workflowId: string,
): Promise<GrantRow[]> {
  const result = await db.select<GrantRow>(
    TABLE,
    { workspace_id: workspaceId, workflow_id: workflowId },
    COLS,
  );
  if (result.error || !result.data) return [];
  return result.data.sort((a, b) => a.grantee_email.localeCompare(b.grantee_email));
}

/** Grants made TO a given user (for the "Shared with you" list). */
export async function listGrantsForGrantee(granteeUserId: string): Promise<GrantRow[]> {
  const result = await db.select<GrantRow>(
    TABLE,
    { grantee_user_id: granteeUserId },
    COLS,
  );
  if (result.error || !result.data) return [];
  return result.data.sort((a, b) =>
    (b.last_accessed_at ?? b.created_at).localeCompare(a.last_accessed_at ?? a.created_at),
  );
}

/** Grants the user has made to others (for the "Shared by you" list). */
export async function listGrantsForOwner(ownerUserId: string): Promise<GrantRow[]> {
  const result = await db.select<GrantRow>(
    TABLE,
    { owner_user_id: ownerUserId },
    COLS,
  );
  if (result.error || !result.data) return [];
  return result.data.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ── Workspace-scoped sharing ─────────────────────────────────────────────────
// Whole-workspace shares reuse the same table with workflow_id = WORKSPACE_SCOPE.

export const WORKSPACE_SCOPE = "*";

export async function shareWorkspace(args: {
  workspaceId: string;
  workspaceName: string;
  ownerUserId: string;
  ownerEmail: string;
  granteeEmail: string;
}): Promise<GrantRow> {
  return createGrant({
    workspaceId: args.workspaceId,
    workflowId: WORKSPACE_SCOPE,
    workflowName: args.workspaceName,
    ownerUserId: args.ownerUserId,
    ownerEmail: args.ownerEmail,
    granteeEmail: args.granteeEmail,
  });
}

/** Members a workspace is shared with (owner's Share modal). */
export async function listWorkspaceMembers(workspaceId: string): Promise<GrantRow[]> {
  return listGrantsForWorkflow(workspaceId, WORKSPACE_SCOPE);
}

/** Workspaces shared TO a given user (their "Shared with you" list). */
export async function listSharedWorkspaces(granteeUserId: string): Promise<GrantRow[]> {
  const all = await listGrantsForGrantee(granteeUserId);
  return all.filter((g) => g.workflow_id === WORKSPACE_SCOPE);
}

/** Workspaces a given user has shared with others ("Shared by you" list). */
export async function listWorkspacesSharedByOwner(ownerUserId: string): Promise<GrantRow[]> {
  const all = await listGrantsForOwner(ownerUserId);
  return all.filter((g) => g.workflow_id === WORKSPACE_SCOPE);
}

/** Is this workspace shared with this user (membership check)? */
export async function isWorkspaceMember(workspaceId: string, granteeUserId: string): Promise<GrantRow | null> {
  const members = await listWorkspaceMembers(workspaceId);
  return members.find((g) => g.grantee_user_id === granteeUserId) ?? null;
}

export async function getGrant(grantId: string): Promise<GrantRow | null> {
  const result = await db.selectOne<GrantRow>(TABLE, { grant_id: grantId }, COLS);
  if (result.error || !result.data) return null;
  return result.data;
}

export async function revokeGrant(grantId: string): Promise<void> {
  const result = await db.del(TABLE, { grant_id: grantId });
  if (result.error) {
    throw new Error(`Failed to revoke grant: ${result.error}`);
  }
}

/**
 * Bind any pending invites for this email to the user's account. Called when a
 * user views their Open panel: a grant created before they had an account (or
 * before they signed in) gets its grantee_user_id filled in. One canonical
 * email per user.
 */
export async function claimGrants(granteeEmail: string, granteeUserId: string): Promise<void> {
  const email = normalizeEmail(granteeEmail);
  // Only claim rows not yet bound to a user.
  const pending = await db.select<GrantRow>(
    TABLE,
    { grantee_email: email, grantee_user_id: null },
    "grant_id",
  );
  if (pending.error || !pending.data || pending.data.length === 0) return;
  await db.update(
    TABLE,
    { grantee_email: email, grantee_user_id: null },
    { grantee_user_id: granteeUserId },
  );
}

export async function touchGrantAccess(grant: GrantRow): Promise<void> {
  await db.update(
    TABLE,
    { grant_id: grant.grant_id },
    {
      last_accessed_at: new Date().toISOString(),
      access_count: (grant.access_count ?? 0) + 1,
    },
  );
}

// ── Slice extraction ─────────────────────────────────────────────────────────
// Given the owner's fully-decrypted .wfp, pull out only what the grantee is
// allowed to see: one workflow, its sessions, the names+descriptions of tools
// it references (code stripped), and the names of knowledge packs it
// references (content stripped). Everything else stays server-side.

export interface WorkflowSlice {
  workflow: Workflow;
  sessions: Session[];
  tools: Array<{ name: string; description: string }>;
  knowledgeNames: string[];
}

export function extractWorkflowSlice(wfp: WfpFile, workflowId: string): WorkflowSlice | null {
  const workflow = (wfp.workflows ?? []).find((w) => w.id === workflowId);
  if (!workflow) return null;

  const sessions = (wfp.sessions ?? []).filter((s) => s.workflow_id === workflowId);

  // Tools referenced by this workflow's nodes — name + description only.
  const referencedToolIds = new Set(
    (workflow.nodes ?? []).map((n) => n.tool_id).filter(Boolean),
  );
  const tools = (wfp.tools ?? [])
    .filter((t: Tool) => referencedToolIds.has(t.tool_id))
    .map((t) => ({ name: t.name, description: t.description }));

  // Knowledge packs referenced via {{name}} anywhere in the workflow — names only.
  const workflowJson = JSON.stringify(workflow);
  const knowledgeNames = (wfp.knowledge ?? [])
    .filter((p) => workflowJson.includes(`{{${p.name}}}`))
    .map((p) => p.name);

  return { workflow, sessions, tools, knowledgeNames };
}
