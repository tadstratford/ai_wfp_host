// Workspace access checks — the single source of truth for "may this user open
// this workspace?". Used by the workspace route guard (/w/:id/*).
//
// Two independent sources, because ownership and sharing live in different
// places (see memory/project_app_restructure.md §Authorization):
//   - OWNERSHIP: the `workspaceStore` row's `user_id` (a user's own workspaces,
//     whether or not they've ever been shared). NOT in the grants table.
//   - SHARES:    a row in Supabase `workspace_grants` (workspace shared TO this
//     user by its owner).
//
// Checking grants alone would lock owners out of their own unshared workspaces.

import { getWorkspaceMeta } from "./workspaceStore";
import { isWorkspaceMember } from "./workflowGrants";

/** True if `userId` owns the workspace (workspaceStore row user_id). */
export async function isWorkspaceOwner(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const meta = await getWorkspaceMeta(workspaceId);
  return !!meta && meta.userId === userId;
}

/**
 * True if `userId` may access the workspace: owner OR an active share member.
 * This is the authorization check the workspace guard runs on every /w/:id/*
 * request — the URL is an identifier, not a credential.
 */
export async function canAccessWorkspace(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  if (await isWorkspaceOwner(workspaceId, userId)) return true;
  return !!(await isWorkspaceMember(workspaceId, userId));
}
