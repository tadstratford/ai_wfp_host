// emailInbox/inboundValidation — shared routing + allowlist checks for inbound
// email, used by BOTH the public webhook (src/server/inbound/router.ts) and the
// dev-only raw test entrance. Kept in one place so the two can never diverge.
//
// Scope: transport-level authorization — resolve the recipient address
// (key+secret), parse the sender, then apply the workspace allowlist and the
// fail-closed server allowlist. Size-capping and headless-open feasibility are
// deliberately left to the caller (the webhook sizes the body AFTER fetching it
// from Resend; the dev entrance sizes the inline body it is handed).

import { parseWorkspaceAddress, authenticateInboundAddress, normalizeEmail } from "./address";
import { parseUserAddress, authenticateUserAddress, type UserAddress } from "./userAddress";
import { isInboundAllowed } from "./serverAllowlist";
import type { InboundAddress } from "./types";

export const MAX_INBOUND_EMAIL_BYTES = 1_000_000; // 1 MB total (subject + bodies + attachments)

export interface InboundCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface InboundResolution {
  checks: InboundCheck[];
  accepted: boolean;
  dropReason: string | null;
  addressRow: InboundAddress | null;
  userAddressRow: UserAddress | null;
  fromEmail: string | null;
  fromName: string | null;
  toAddress: string | null;
}

/** Parse a `From`-style address: `"Name <email>"` or bare `"email"`. */
export function parseAddress(input: unknown): { name: string | null; email: string | null } {
  if (typeof input !== "string" || !input.trim()) return { name: null, email: null };
  const s = input.trim();
  const bracket = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (bracket) {
    return { name: bracket[1].trim() || null, email: normalizeEmail(bracket[2]) };
  }
  return { name: null, email: normalizeEmail(s) };
}

/**
 * Resolve and authorize an inbound message. Mirrors the webhook's recipient →
 * sender → workspace allowlist → server allowlist ordering (fail on first drop).
 */
export async function resolveInboundEmail(
  recipients: string[],
  from: string,
): Promise<InboundResolution> {
  const checks: InboundCheck[] = [];
  const result: InboundResolution = {
    checks,
    accepted: false,
    dropReason: null,
    addressRow: null,
    userAddressRow: null,
    fromEmail: null,
    fromName: null,
    toAddress: null,
  };

  const fail = (dropReason: string): InboundResolution => {
    result.dropReason = dropReason;
    return result;
  };

  // 1. Resolve the recipient address (workspace inbox, then user inbox).
  for (const r of recipients) {
    const wsParsed = parseWorkspaceAddress(String(r));
    if (wsParsed) {
      const authed = await authenticateInboundAddress(wsParsed.key, wsParsed.secret);
      if (authed) {
        result.addressRow = authed;
        result.toAddress = String(r);
        break;
      }
      continue;
    }
    const userParsed = parseUserAddress(String(r));
    if (userParsed) {
      const authed = await authenticateUserAddress(userParsed.slug, userParsed.secret);
      if (authed) {
        result.userAddressRow = authed;
        result.toAddress = String(r);
        break;
      }
    }
  }

  const resolved = !!(result.addressRow || result.userAddressRow);
  checks.push({
    id: "recipient",
    label: "Recipient address",
    ok: resolved,
    detail: result.addressRow
      ? `Resolved to workspace inbox (${result.addressRow.address_key})`
      : result.userAddressRow
        ? `Resolved to user inbox (${result.userAddressRow.address_key})`
        : "No matching/authorized inbound address",
  });
  if (!resolved) return fail("No matching/authorized inbound address");

  // 2. Sender.
  const parsed = parseAddress(from);
  result.fromEmail = parsed.email;
  result.fromName = parsed.name;
  const hasSender = !!result.fromEmail;
  checks.push({
    id: "sender",
    label: "Sender",
    ok: hasSender,
    detail: hasSender ? `From ${result.fromEmail}` : "Missing sender address",
  });
  if (!hasSender) return fail("Missing sender address");

  // 3. Workspace/user allowlist — non-empty means only these senders are accepted.
  const allowlist =
    result.addressRow?.allowlisted_senders ?? result.userAddressRow?.allowlisted_senders ?? [];
  const allowlistOk = allowlist.length === 0 || allowlist.includes(result.fromEmail!);
  checks.push({
    id: "workspace_allowlist",
    label: "Workspace allowlist",
    ok: allowlistOk,
    detail:
      allowlist.length === 0
        ? "No workspace allowlist (accept anyone)"
        : allowlistOk
          ? "Sender is allowlisted"
          : `Sender not in workspace allowlist (${allowlist.join(", ")})`,
  });
  if (!allowlistOk) return fail("Sender not allowlisted");

  // 4. Server-level inbound allowlist — fail-closed (empty = deny all).
  const serverOk = await isInboundAllowed(result.fromEmail!);
  checks.push({
    id: "server_allowlist",
    label: "Server allowlist",
    ok: serverOk,
    detail: serverOk
      ? "Sender is on the server inbound allowlist"
      : "Sender not on the server inbound allowlist (fail-closed)",
  });
  if (!serverOk) return fail("Sender not on the server inbound allowlist");

  result.accepted = true;
  return result;
}
