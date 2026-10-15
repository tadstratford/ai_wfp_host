// inboundEmail/address — CRUD for per-workspace inbound email addresses.
//
// Address format: `wf-<key>.<secret>@<INBOUND_EMAIL_DOMAIN>`.
//   - `key`    — a human-friendly slug of the workspace name (uniquified), so the
//                address is recognizable; resolved pre-open for routing.
//   - `secret` — short human-friendly authenticator (6 chars). Stored
//                AES-256-GCM encrypted with APP_SECRET (never plaintext) so the
//                Settings UI can re-display the full address, but the webhook
//                can still verify it.

import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "@backend/core/crypto";
import * as db from "../../server/admin/supabase";
import type { InboundAddress } from "./types";

const TABLE = "inbound_email_addresses";
const COLS =
  "address_key,workspace_id,user_id,database_id,secret_encrypted,allowlisted_senders,outbound_allowlist,enabled,created_at";

const DOMAIN = () => process.env.INBOUND_EMAIL_DOMAIN || "in.workflowpeople.com";

function generateKey(): string {
  return randomBytes(4).toString("hex"); // 8 hex chars (fallback when no workspace name)
}

function generateSecret(): string {
  // Short, human-friendly authenticator (6 lowercase alphanumeric chars ≈ 31
  // bits). Deliberately short for copy/paste convenience; the allowlist and
  // Svix signature provide additional layers.
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
  const LENGTH = 6;
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Turn a workspace name into a URL/address-safe slug (`[a-z0-9-]`, no dots). */
function slugifyWorkspaceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Ensure a candidate key is globally unique; append a short suffix if taken. */
async function uniqueKey(base: string): Promise<string> {
  let candidate = base;
  let i = 0;
  while (await getInboundAddressByKey(candidate)) {
    i++;
    candidate = `${base}-${randomBytes(i >= 2 ? 4 : 2).toString("hex")}`;
  }
  return candidate;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parse the local part of `wf-<key>.<secret>@domain` into key + secret.
 * Both are hex tokens (no dots), so the first dot is the separator. Returns
 * null for anything that isn't a workspace inbox address.
 */
export function parseWorkspaceAddress(address: string): { key: string; secret: string } | null {
  const at = address.lastIndexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  if (!local.startsWith("wf-")) return null;
  const body = local.slice(3);
  const dot = body.indexOf(".");
  if (dot <= 0) return null;
  return { key: body.slice(0, dot), secret: body.slice(dot + 1) };
}

export function buildInboundAddress(addressKey: string, secret: string): string {
  return `wf-${addressKey}.${secret}@${DOMAIN()}`;
}

interface AddressRow {
  address_key: string;
  workspace_id: string;
  user_id: string;
  database_id: string | null;
  secret_encrypted: string;
  allowlisted_senders: string[] | null;
  outbound_allowlist: string[] | null;
  enabled: boolean;
  created_at: string;
}

function mapRow(row: AddressRow): InboundAddress {
  return {
    address_key: row.address_key,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    database_id: row.database_id ?? null,
    secret_encrypted: row.secret_encrypted,
    allowlisted_senders: Array.isArray(row.allowlisted_senders) ? row.allowlisted_senders : [],
    outbound_allowlist: Array.isArray(row.outbound_allowlist) ? row.outbound_allowlist : [],
    enabled: row.enabled,
    created_at: row.created_at,
  };
}

/** Look up an inbound address by its `address_key` slug. */
export async function getInboundAddressByKey(
  addressKey: string,
): Promise<InboundAddress | null> {
  const result = await db.selectOne<AddressRow>(TABLE, { address_key: addressKey }, COLS);
  if (result.error) {
    throw new Error(`Failed to load inbound address: ${result.error}`);
  }
  return result.data ? mapRow(result.data) : null;
}

/** Look up the inbound address for a workspace (used by the Settings UI). */
export async function getInboundAddressByWorkspace(
  workspaceId: string,
): Promise<InboundAddress | null> {
  const result = await db.select<AddressRow>(TABLE, { workspace_id: workspaceId }, COLS);
  if (result.error) {
    throw new Error(`Failed to load inbound address: ${result.error}`);
  }
  if (!result.data || result.data.length === 0) return null;
  return mapRow(result.data[0]);
}

/**
 * Decrypt and re-display the full address for an existing inbound address row.
 * Returns the empty string if decryption fails (e.g. APP_SECRET rotated).
 */
export function revealFullAddress(addr: InboundAddress): string {
  const secret = decrypt(addr.secret_encrypted);
  if (!secret) return "";
  return buildInboundAddress(addr.address_key, secret);
}

/** Get-or-create the inbound address for a workspace. Returns the full address. */
export async function ensureInboundAddress(
  databaseId: string,
  workspaceId: string,
  userId: string,
  workspaceName?: string,
): Promise<{ address: InboundAddress; fullAddress: string }> {
  const existing = await getInboundAddressByWorkspace(workspaceId);
  if (existing) {
    return { address: existing, fullAddress: revealFullAddress(existing) };
  }

  const base = slugifyWorkspaceName(workspaceName ?? "") || generateKey();
  const addressKey = await uniqueKey(base);
  const secret = generateSecret();
  const row: AddressRow = {
    address_key: addressKey,
    workspace_id: workspaceId,
    user_id: userId,
    database_id: databaseId || null,
    secret_encrypted: encrypt(secret),
    allowlisted_senders: [],
    outbound_allowlist: [],
    enabled: true,
    created_at: new Date().toISOString(),
  };

  try {
    await db.insert(TABLE, row);
  } catch (err) {
    // Concurrent create — the other request won; read it back.
    const raced = await getInboundAddressByWorkspace(workspaceId);
    if (raced) return { address: raced, fullAddress: revealFullAddress(raced) };
    throw err;
  }

  return { address: mapRow(row), fullAddress: buildInboundAddress(addressKey, secret) };
}

/**
 * Verify an inbound `key` + `secret` pair. Returns the address row on success,
 * or null when the key is unknown, the secret doesn't match, or it is disabled.
 * The secret comparison is timing-safe.
 */
export async function authenticateInboundAddress(
  addressKey: string,
  secret: string,
): Promise<InboundAddress | null> {
  const addr = await getInboundAddressByKey(addressKey);
  if (!addr || !addr.enabled) return null;

  const stored = decrypt(addr.secret_encrypted);
  if (!stored) return null;

  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return addr;
}

/** Rotate the secret, keeping the key. Returns the new full address. */
export async function rotateSecret(addressKey: string): Promise<string | null> {
  const addr = await getInboundAddressByKey(addressKey);
  if (!addr) return null;

  const secret = generateSecret();
  const result = await db.update(
    TABLE,
    { address_key: addressKey },
    { secret_encrypted: encrypt(secret) },
  );
  if (result.error) {
    throw new Error(`Failed to rotate inbound secret: ${result.error}`);
  }
  return buildInboundAddress(addressKey, secret);
}

/** Revoke (delete) an inbound address. */
export async function revokeInboundAddress(addressKey: string): Promise<void> {
  await db.del(TABLE, { address_key: addressKey });
}

/** Replace the sender allowlist for an address. Empty = accept anyone. */
export async function setAllowlist(
  addressKey: string,
  emails: string[],
): Promise<void> {
  const normalized = emails.map(normalizeEmail).filter(Boolean);
  await db.update(TABLE, { address_key: addressKey }, { allowlisted_senders: normalized });
}

/** Replace the outbound recipient allowlist for an address. Empty = send to anyone. */
export async function setOutboundAllowlist(
  addressKey: string,
  emails: string[],
): Promise<void> {
  const normalized = emails.map(normalizeEmail).filter(Boolean);
  await db.update(TABLE, { address_key: addressKey }, { outbound_allowlist: normalized });
}

/** Outbound allowlist for a workspace (empty = unrestricted). */
export async function getOutboundAllowlist(workspaceId: string): Promise<string[]> {
  const addr = await getInboundAddressByWorkspace(workspaceId);
  return addr?.outbound_allowlist ?? [];
}

/** Enable or disable an inbound address. */
export async function setEnabled(addressKey: string, enabled: boolean): Promise<void> {
  await db.update(TABLE, { address_key: addressKey }, { enabled });
}
