/**
 * Capability credential storage.
 *
 * API-key (and other) capability credentials live in the host's encrypted
 * secrets vault under a workspace-scoped name `capability:<key>:<scope>`, so
 * each workspace keeps its own credential without colliding with another
 * workspace's. Values are never written into the .wfp document.
 *
 * OAuth2 capabilities (e.g. QBO) use the same vault via their own token
 * exchange — the key convention here is shared so every capability's
 * credential is stored and looked up the same way.
 */

/** Secret name for a capability credential, scoped to a workspace. */
export function capabilitySecretKey(key: string, scope: string): string {
  return `capability:${key}:${scope}`;
}

/** Persist a capability credential for a workspace (encrypted at rest). */
export async function saveCapabilitySecret(
  scope: string,
  key: string,
  value: string,
): Promise<void> {
  const { userManager } = await import("@backend/core/admin/userManager");
  await userManager.saveSecretByWorkspaceId(scope, capabilitySecretKey(key, scope), value);
}

/** Read a capability credential for a workspace, or null when absent. */
export async function getCapabilitySecret(
  scope: string,
  key: string,
): Promise<string | null> {
  const { userManager } = await import("@backend/core/admin/userManager");
  return userManager.getSecretByWorkspaceId(scope, capabilitySecretKey(key, scope));
}

/** Delete a capability credential for a workspace. */
export async function deleteCapabilitySecret(scope: string, key: string): Promise<void> {
  const { userManager } = await import("@backend/core/admin/userManager");
  await userManager.deleteSecretByWorkspaceId(scope, capabilitySecretKey(key, scope));
}
