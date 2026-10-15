// emailInbox/delivery — internal (same-instance) mail delivery.
//
// When an outbound message's recipient address resolves to a workspace inbox on
// THIS instance, we deliver directly into that workspace's archive and trigger
// its email agent — no Resend round-trip. This is the "emulate SMTP with
// Supabase writes" path for wfp↔wfp traffic. External recipients still go
// through Resend (see outbound.ts sendWorkspaceEmail).
//
// The outbound "Sent" record for the sender is written by the caller (see
// outbound.ts), keeping this module free of a dependency cycle with agent.ts
// (which imports outbound for the gated-reply send). The agent is triggered via
// a dynamic import for the same reason.

import { randomUUID } from "node:crypto";
import type { SendEmailInput } from "../../shared/email/sendEmail";
import {
  authenticateInboundAddress,
  parseWorkspaceAddress,
  getInboundAddressByWorkspace,
  revealFullAddress,
} from "./address";
import { writeEmail, writeAttachments } from "./store";
import type { InboundEmail } from "./types";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@workflowpeople.com";

/** Resolve the sender workspace's inbound address as the From identity so the
 *  recipient's workflow can reply back to it. Falls back to the white-label. */
async function senderIdentity(workspaceId: string): Promise<string> {
  const addr = await getInboundAddressByWorkspace(workspaceId);
  if (addr) {
    const full = revealFullAddress(addr);
    if (full) return full;
  }
  return FROM_EMAIL;
}

/**
 * Deliver an outbound message to a local workspace inbox when the recipient
 * address resolves to a workspace on this instance. Writes the inbound record,
 * fires the recipient's email agent (fire-and-forget), and returns true.
 * Returns false (caller falls through to Resend) when the address is not a
 * local workspace inbox.
 */
export async function deliverLocalIfPossible(
  senderWorkspaceId: string,
  input: SendEmailInput,
): Promise<boolean> {
  const parsed = parseWorkspaceAddress(input.to);
  if (!parsed) return false;
  const target = await authenticateInboundAddress(parsed.key, parsed.secret);
  if (!target) return false;

  const emailId = randomUUID();
  const now = new Date().toISOString();
  const bodyText = input.text ?? "";
  const bodyHtml = input.html ?? "";
  const sizeBytes = Buffer.byteLength(`${input.subject ?? ""}${bodyText}${bodyHtml}`, "utf8");

  const email: InboundEmail = {
    email_id: emailId,
    workspace_id: target.workspace_id,
    from_email: await senderIdentity(senderWorkspaceId),
    from_name: null,
    to_address: input.to,
    subject: input.subject ?? null,
    date: now,
    thread_id: null,
    size_bytes: sizeBytes,
    status: "received",
    session_id: null,
    fail_reason: null,
    created_at: now,
    entry: {
      ...(bodyText ? { textBody: bodyText } : {}),
      ...(bodyHtml ? { htmlBody: bodyHtml } : {}),
    },
  };

  await writeEmail(email);

  if (input.attachments && input.attachments.length > 0) {
    await writeAttachments(
      input.attachments.map((a) => ({
        attachment_id: randomUUID(),
        email_id: emailId,
        filename: a.filename ?? null,
        mime_type: null,
        size_bytes: a.content?.length ?? null,
        content_base64: a.content ?? null,
      })),
    );
  }

  // Fire the recipient's email agent (dynamic import avoids a static cycle).
  void import("./agent").then(({ processInboundEmail }) =>
    processInboundEmail(email, target).catch((err) => {
      console.error(`[delivery] internal agent failed for ${emailId}:`, err);
    }),
  );

  return true;
}
