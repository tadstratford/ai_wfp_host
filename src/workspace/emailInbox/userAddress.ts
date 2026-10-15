// emailInbox/userAddress — CRUD for per-user (company-level) inbox addresses.
//
// Address format: `<slug>.<secret>@<INBOUND_EMAIL_DOMAIN>`, e.g.
// `jane.smith.43b2u@workflowpeople.com`. The `slug` is a human-friendly slug of
// the user's name (may contain dots); the `secret` (final dot-separated
// segment) is a short capability authenticator, so only people who know the
// address can reach the user. Inbound mail to a user address is ARCHIVE-ONLY
// (no workflow trigger) — it lands in the user's inbox for review.

import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "@backend/core/crypto";
import * as db from "../../server/admin/supabase";

const TABLE = "user_email_addresses";
const COLS =
  "address_key,user_id,secret_encrypted,allowlisted_senders,outbound_allowlist,enabled,created_at";
const DOMAIN = () => process.env.INBOUND_EMAIL_DOMAIN || "in.workflowpeople.com";

export interface UserAddress {
  address_key: string;
  user_id: string;
  secret_encrypted: string;
  allowlisted_senders: string[];
  outbound_allowlist: string[];
  enabled: boolean;
  created_at: string;
}

function generateSecret(): string {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Slug a display name like "Jane Smith" → "jane.smith" (dots preserved). */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
}

function generateKey(): string {
  return randomBytes(4).toString("hex");
}

export function buildUserAddress(slug: string, secret: string): string {
  return `${slug}.${secret}@${DOMAIN()}`;
}

/** Parse `<slug>.<secret>@domain` by LAST dot (names may contain dots). Returns
 *  null for workspace addresses (`wf-` prefix) or addresses without a secret. */
export function parseUserAddress(address: string): { slug: string; secret: string } | null {
  const at = address.lastIndexOf("@");
  const local = at === -1 ? address : address.slice(0, at);
  if (!local || local.startsWith("wf-")) return null;
  const lastDot = local.lastIndexOf(".");
  if (lastDot <= 0) return null;
  return { slug: local.slice(0, lastDot), secret: local.slice(lastDot + 1) };
}

interface UserAddressRow {
  address_key: string;
  user_id: string;
  secret_encrypted: string;
  allowlisted_senders: string[] | null;
  outbound_allowlist: string[] | null;
  enabled: boolean;
  created_at: string;
}

function mapRow(row: UserAddressRow): UserAddress {
  return {
    address_key: row.address_key,
    user_id: row.user_id,
    secret_encrypted: row.secret_encrypted,
    allowlisted_senders: Array.isArray(row.allowlisted_senders) ? row.allowlisted_senders : [],
    outbound_allowlist: Array.isArray(row.outbound_allowlist) ? row.outbound_allowlist : [],
    enabled: row.enabled,
    created_at: row.created_at,
  };
}

export async function getUserAddressByKey(addressKey: string): Promise<UserAddress | null> {
  const result = await db.selectOne<UserAddressRow>(TABLE, { address_key: addressKey }, COLS);
  if (result.error) {
    throw new Error(`Failed to load user address: ${result.error}`);
  }
  return result.data ? mapRow(result.data) : null;
}

export async function getUserAddressByUser(userId: string): Promise<UserAddress | null> {
  const result = await db.select<UserAddressRow>(TABLE, { user_id: userId }, COLS);
  if (result.error) {
    throw new Error(`Failed to load user address: ${result.error}`);
  }
  if (!result.data || result.data.length === 0) return null;
  return mapRow(result.data[0]);
}

export function revealUserAddress(addr: UserAddress): string {
  const secret = decrypt(addr.secret_encrypted);
  if (!secret) return "";
  return buildUserAddress(addr.address_key, secret);
}

/** Get-or-create the user's inbox address. Returns the full address. */
export async function ensureUserInboundAddress(
  userId: string,
  userName?: string,
): Promise<{ address: UserAddress; fullAddress: string }> {
  const existing = await getUserAddressByUser(userId);
  if (existing) {
    return { address: existing, fullAddress: revealUserAddress(existing) };
  }

  let base = slugifyName(userName ?? "");
  if (!base) base = generateKey();

  // Uniquify the slug (append a short hex suffix on collision).
  let addressKey = base;
  let i = 0;
  while (await getUserAddressByKey(addressKey)) {
    i++;
    addressKey = `${base}-${randomBytes(i >= 2 ? 4 : 2).toString("hex")}`;
  }

  const secret = generateSecret();
  const row: UserAddressRow = {
    address_key: addressKey,
    user_id: userId,
    secret_encrypted: encrypt(secret),
    allowlisted_senders: [],
    outbound_allowlist: [],
    enabled: true,
    created_at: new Date().toISOString(),
  };

  try {
    await db.insert(TABLE, row);
  } catch (err) {
    const raced = await getUserAddressByUser(userId);
    if (raced) return { address: raced, fullAddress: revealUserAddress(raced) };
    throw err;
  }

  return { address: mapRow(row), fullAddress: buildUserAddress(addressKey, secret) };
}

/** Verify a user `slug` + `secret` pair. Timing-safe; null on any failure. */
export async function authenticateUserAddress(
  slug: string,
  secret: string,
): Promise<UserAddress | null> {
  const addr = await getUserAddressByKey(slug);
  if (!addr || !addr.enabled) return null;

  const stored = decrypt(addr.secret_encrypted);
  if (!stored) return null;

  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return addr;
}
