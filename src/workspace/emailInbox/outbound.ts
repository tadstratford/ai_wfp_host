// inboundEmail/outbound — Supabase-backed tracking of outbound (sent) emails,
// modeled on inbound store.ts. Sends are recorded here so the "Sent" view can
// list them without reaching into the .wfp blob.

import { randomUUID } from "node:crypto";
import * as db from "../../server/admin/supabase";
import { sendEmail } from "../../shared/email/sendEmail";
import type { SendEmailInput, SendEmailResult } from "../../shared/email/sendEmail";
import type { InboundEmail, OutboundEmail } from "./types";
import { getOutboundAllowlist, parseWorkspaceAddress, authenticateInboundAddress } from "./address";
import { isOutboundAllowed } from "./serverAllowlist";
import { deliverLocalIfPossible } from "./delivery";
import { writeEmail } from "./store";
import { ensureUserInboundAddress } from "./userAddress";

const TABLE = "outbound_emails";

const COLS =
  "email_id,workspace_id,user_id,to_email,to_name,cc,subject,body_text,body_html,reply_to,in_reply_to,workflow_id,workflow_name,status,created_at";

interface OutboundRow {
  email_id: string;
  workspace_id: string | null;
  user_id: string | null;
  to_email: string | null;
  to_name: string | null;
  cc: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  reply_to: string | null;
  in_reply_to: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  status: string | null;
  created_at: string;
}

function mapRow(row: OutboundRow): OutboundEmail {
  return {
    email_id: row.email_id,
    workspace_id: row.workspace_id ?? null,
    user_id: row.user_id ?? null,
    to_email: row.to_email ?? null,
    to_name: row.to_name ?? null,
    cc: row.cc ?? null,
    subject: row.subject ?? null,
    body_text: row.body_text ?? null,
    body_html: row.body_html ?? null,
    reply_to: row.reply_to ?? null,
    in_reply_to: row.in_reply_to ?? null,
    workflow_id: row.workflow_id ?? null,
    workflow_name: row.workflow_name ?? null,
    status: row.status ?? null,
    created_at: row.created_at,
  };
}

/** Record a sent email for the "Sent" view. Swallows 23503 (no workspace row). */
export async function writeSentEmail(
  workspaceId: string,
  record: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    cc?: string;
    status?: string;
    inReplyTo?: string;
    workflowId?: string;
    workflowName?: string;
  },
): Promise<void> {
  const result = await db.insert(TABLE, {
    email_id: crypto.randomUUID(),
    workspace_id: workspaceId,
    user_id: null,
    to_email: record.to,
    to_name: null,
    cc: record.cc ?? null,
    subject: record.subject,
    body_text: record.text ?? null,
    body_html: record.html ?? null,
    reply_to: record.replyTo ?? null,
    in_reply_to: record.inReplyTo ?? null,
    workflow_id: record.workflowId ?? null,
    workflow_name: record.workflowName ?? null,
    status: record.status ?? "sent",
    created_at: new Date().toISOString(),
  });
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to write outbound email: ${result.error}`);
  }
}

/** List a workspace's sent emails, newest first. */
export async function listSentEmails(workspaceId: string): Promise<OutboundEmail[]> {
  const result = await db.select<OutboundRow>(TABLE, { workspace_id: workspaceId }, COLS);
  if (result.error) {
    throw new Error(`Failed to list outbound emails: ${result.error}`);
  }
  const rows = (result.data ?? []).map(mapRow);
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return rows;
}

/**
 * Send an outbound email and record it in the workspace's "Sent" list. Returns
 * the Resend result. On success the send is logged; on failure nothing is recorded.
 * Enforces the workspace's outbound recipient allowlist (non-empty ⇒ `to` must match).
 */
export async function sendWorkspaceEmail(
  workspaceId: string,
  input: SendEmailInput,
  opts?: { inReplyToEmailId?: string; workflowId?: string; workflowName?: string },
): Promise<SendEmailResult> {
  const recipients = [input.to, ...(input.cc ? input.cc.split(",") : [])]
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  // Per-workspace outbound allowlist — empty = send to anyone.
  const allowlist = await getOutboundAllowlist(workspaceId);
  if (allowlist.length > 0 && !recipients.every((r) => allowlist.includes(r))) {
    return { success: false, message: "A recipient is not on the outbound allowlist." };
  }

  // Internal delivery: a single recipient that resolves to a workspace inbox on
  // THIS instance is delivered directly (no Resend). Record the outbound side
  // for the sender's Sent view and return.
  if (!input.cc && recipients.length === 1) {
    const delivered = await deliverLocalIfPossible(workspaceId, input);
    if (delivered) {
      await writeSentEmail(workspaceId, {
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.replyTo,
        cc: input.cc,
        status: "sent",
        inReplyTo: opts?.inReplyToEmailId,
        workflowId: opts?.workflowId,
        workflowName: opts?.workflowName,
      });
      return { success: true, message: "Delivered internally." };
    }
  }

  // Server-level outbound allowlist — fail-closed (empty = deny all). Every
  // recipient must be listed here in addition to the workspace allowlist.
  const server = await isOutboundAllowed(recipients);
  if (!server.allowed) {
    return {
      success: false,
      message: `Recipient(s) not on the server outbound allowlist: ${server.blocked.join(", ")}.`,
    };
  }

  const result = await sendEmail(input);
  if (result.success) {
    await writeSentEmail(workspaceId, {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      cc: input.cc,
      status: "sent",
      inReplyTo: opts?.inReplyToEmailId,
      workflowId: opts?.workflowId,
      workflowName: opts?.workflowName,
    });
  }
  return result;
}

// ── User-level sends (company-level mailbox) ────────────────────────────────

/** Record a user-authored sent email (no workspace). */
export async function writeUserSentEmail(
  userId: string,
  record: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    from?: string;
    replyTo?: string;
    cc?: string;
    status?: string;
    inReplyTo?: string;
  },
): Promise<void> {
  const result = await db.insert(TABLE, {
    email_id: randomUUID(),
    workspace_id: null,
    user_id: userId,
    to_email: record.to,
    to_name: null,
    cc: record.cc ?? null,
    subject: record.subject,
    body_text: record.text ?? null,
    body_html: record.html ?? null,
    reply_to: record.replyTo ?? null,
    in_reply_to: record.inReplyTo ?? null,
    status: record.status ?? "sent",
    created_at: new Date().toISOString(),
  });
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to write user outbound email: ${result.error}`);
  }
}

/**
 * Send an email authored by a user's company-level address. Recipient routing:
 * a local workspace inbox → internal delivery (no Resend); anything else → Resend
 * (subject to the server outbound allowlist).
 */
export async function sendUserEmail(
  userId: string,
  userName: string | undefined,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const { fullAddress } = await ensureUserInboundAddress(userId, userName);

  const recipients = [input.to, ...(input.cc ? input.cc.split(",") : [])]
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);

  // Internal delivery to a local workspace inbox.
  if (!input.cc && recipients.length === 1) {
    const parsed = parseWorkspaceAddress(input.to);
    if (parsed) {
      const target = await authenticateInboundAddress(parsed.key, parsed.secret);
      if (target) {
        const emailId = randomUUID();
        const now = new Date().toISOString();
        const text = input.text ?? "";
        const html = input.html ?? "";
        const email: InboundEmail = {
          email_id: emailId,
          workspace_id: target.workspace_id,
          from_email: fullAddress,
          from_name: userName ?? null,
          to_address: input.to,
          subject: input.subject ?? null,
          date: now,
          thread_id: null,
          size_bytes: Buffer.byteLength(`${input.subject ?? ""}${text}${html}`, "utf8"),
          status: "received",
          session_id: null,
          fail_reason: null,
          created_at: now,
          entry: {
            ...(text ? { textBody: text } : {}),
            ...(html ? { htmlBody: html } : {}),
          },
        };
        await writeEmail(email);
        await writeUserSentEmail(userId, {
          to: input.to,
          subject: input.subject ?? "",
          text: text || undefined,
          html: html || undefined,
          from: fullAddress,
          replyTo: input.replyTo ?? fullAddress,
          cc: input.cc,
          inReplyTo: input.inReplyTo,
        });
        void import("./agent").then(({ processInboundEmail }) =>
          processInboundEmail(email, target).catch((err) => {
            console.error(`[outbound] user internal agent failed for ${emailId}:`, err);
          }),
        );
        return { success: true, message: "Delivered internally." };
      }
    }
  }

  // External → Resend, authored by the user's address, gated on the server allowlist.
  const server = await isOutboundAllowed(recipients);
  if (!server.allowed) {
    return {
      success: false,
      message: `Recipient(s) not on the server outbound allowlist: ${server.blocked.join(", ")}.`,
    };
  }

  const result = await sendEmail({ ...input, from: fullAddress, replyTo: input.replyTo ?? fullAddress });
  if (result.success) {
    await writeUserSentEmail(userId, {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      from: fullAddress,
      replyTo: input.replyTo ?? fullAddress,
      cc: input.cc,
      inReplyTo: input.inReplyTo,
    });
  }
  return result;
}
