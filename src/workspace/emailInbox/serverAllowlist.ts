// emailInbox/serverAllowlist — server-instance-wide inbound/outbound allowlists.
//
// Two lists, independent of the per-workspace allowlists:
//   - server_outbound_allowlist: recipients this instance may email.
//   - server_inbound_allowlist:  senders this instance will accept email from.
//
// BOTH are fail-closed: an EMPTY list means DENY ALL (unlike the per-workspace
// allowlists, where empty = allow anyone). This is deliberate — it protects the
// instance against sending to (or accepting from) stale addresses such as
// former clients or ex-associates. The admin must explicitly add every
// permitted sender/recipient.
//
// A message is delivered only when it passes BOTH the relevant workspace/user
// allowlist AND the matching server list.

import * as db from "../../server/admin/supabase";

const OUTBOUND_TABLE = "server_outbound_allowlist";
const INBOUND_TABLE = "server_inbound_allowlist";

interface AllowlistRow {
  email: string;
  added_by: string | null;
  created_at: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapRow(row: AllowlistRow): string {
  return normalizeEmail(row.email);
}

async function list(table: string): Promise<string[]> {
  const result = await db.select<AllowlistRow>(table, {}, "email,added_by,created_at");
  if (result.error) {
    throw new Error(`Failed to list server allowlist (${table}): ${result.error}`);
  }
  return (result.data ?? []).map(mapRow);
}

async function add(table: string, email: string, addedBy?: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const result = await db.insert(table, {
    email: normalized,
    added_by: addedBy ?? null,
    created_at: new Date().toISOString(),
  });
  if (result.error) {
    throw new Error(`Failed to add to server allowlist (${table}): ${result.error}`);
  }
}

async function remove(table: string, email: string): Promise<void> {
  await db.del(table, { email: normalizeEmail(email) });
}

// ── Outbound ─────────────────────────────────────────────────────────────────

export function listServerOutboundAllowlist(): Promise<string[]> {
  return list(OUTBOUND_TABLE);
}

export function addToServerOutboundAllowlist(email: string, addedBy?: string): Promise<void> {
  return add(OUTBOUND_TABLE, email, addedBy);
}

export function removeFromServerOutboundAllowlist(email: string): Promise<void> {
  return remove(OUTBOUND_TABLE, email);
}

/** Fail-closed: every recipient must be explicitly listed. Empty list ⇒ deny all. */
export async function isOutboundAllowed(
  recipients: string[],
): Promise<{ allowed: boolean; blocked: string[] }> {
  const allowed = new Set(await list(OUTBOUND_TABLE));
  const blocked = recipients
    .map(normalizeEmail)
    .filter((r) => r && !allowed.has(r));
  return { allowed: blocked.length === 0, blocked };
}

// ── Inbound ──────────────────────────────────────────────────────────────────

export function listServerInboundAllowlist(): Promise<string[]> {
  return list(INBOUND_TABLE);
}

export function addToServerInboundAllowlist(email: string, addedBy?: string): Promise<void> {
  return add(INBOUND_TABLE, email, addedBy);
}

export function removeFromServerInboundAllowlist(email: string): Promise<void> {
  return remove(INBOUND_TABLE, email);
}

/** Fail-closed: sender must be explicitly listed. Empty list ⇒ deny all. */
export async function isInboundAllowed(senderEmail: string): Promise<boolean> {
  const normalized = normalizeEmail(senderEmail);
  if (!normalized) return false;
  const allowed = new Set(await list(INBOUND_TABLE));
  return allowed.has(normalized);
}
