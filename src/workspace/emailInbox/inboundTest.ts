// emailInbox/inboundTest — run a full inbound test email through the pipeline.
//
// Shared by the dev-only raw webhook entrance (src/server/inbound/router.ts) and
// the session-gated "Test incoming email" form (src/ui/pages/app/emailInbox).
// Resolves the address, applies the allowlists + size cap + headless-open
// feasibility, then stores the email and runs the headless shadow agent.

import { randomUUID } from "node:crypto";
import {
  resolveInboundEmail,
  MAX_INBOUND_EMAIL_BYTES,
  type InboundCheck,
} from "./inboundValidation";
import { writeEmail, writeUserInboundEmail, writeAttachments, getEmail } from "./store";
import { processInboundEmail } from "./agent";
import { isWorkspaceEncrypted } from "@backend/core/workspace/workspaceStore";
import type { InboundEmail, InboundEmailAttachment } from "./types";

export interface InboundTestResult {
  accepted: boolean;
  dropReason: string | null;
  checks: InboundCheck[];
  emailId?: string;
  status?: string | null;
  sessionId?: string | null;
  failReason?: string | null;
}

export interface InboundTestAttachment {
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  contentBase64: string;
}

export async function runInboundTest(input: {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: InboundTestAttachment[];
  /** When set, reject any address that resolves to a different workspace. */
  expectedWorkspaceId?: string;
}): Promise<InboundTestResult> {
  const from = input.from ?? "";
  const to = input.to ?? "";
  const subject = input.subject ?? "";
  const textBody = input.text ?? "";
  const htmlBody = input.html ?? "";

  const resolved = await resolveInboundEmail(to ? [to] : [], from);
  const checks: InboundCheck[] = [...resolved.checks];
  let accepted = resolved.accepted;
  let dropReason = resolved.dropReason;

  // Workspace scoping (production form): the resolved address must belong to the
  // expected workspace so the form can't trigger another workspace's agent.
  if (accepted && input.expectedWorkspaceId && resolved.addressRow) {
    const match = resolved.addressRow.workspace_id === input.expectedWorkspaceId;
    checks.push({
      id: "workspace_scope",
      label: "Workspace scope",
      ok: match,
      detail: match
        ? "Address belongs to the active workspace"
        : "Address belongs to a different workspace",
    });
    if (!match) {
      accepted = false;
      dropReason = "Address belongs to a different workspace";
    }
  }

  // Headless-open feasibility (workspace addresses only — user inboxes are
  // archive-only, no agent).
  if (accepted && resolved.addressRow) {
    const addr = resolved.addressRow;
    const hasDb = !!addr.database_id;
    let encrypted = false;
    if (hasDb) {
      try {
        encrypted = await isWorkspaceEncrypted(addr.workspace_id);
      } catch { /* treat as openable */ }
    }
    const ok = hasDb && !encrypted;
    checks.push({
      id: "headless",
      label: "Headless open",
      ok,
      detail: !hasDb
        ? "No database_id on address"
        : encrypted
          ? "Encrypted workspace (shadow open is plaintext-only)"
          : "Opens headlessly under a shadow identity",
    });
    if (!ok) {
      accepted = false;
      dropReason = hasDb ? "Encrypted workspace" : "No database_id on address";
    }
  }

  // Size cap (subject + bodies + attachments).
  const attachmentBytes = (input.attachments ?? []).reduce(
    (sum, a) => sum + (Number(a.sizeBytes) || 0),
    0,
  );
  const totalBytes =
    Buffer.byteLength(subject, "utf8") +
    Buffer.byteLength(textBody, "utf8") +
    Buffer.byteLength(htmlBody, "utf8") +
    attachmentBytes;
  if (accepted) {
    const ok = totalBytes <= MAX_INBOUND_EMAIL_BYTES;
    checks.push({
      id: "size",
      label: "Size",
      ok,
      detail: ok ? `${totalBytes} bytes` : `Too large (${totalBytes} bytes, max 1 MB)`,
    });
    if (!ok) {
      accepted = false;
      dropReason = "Email too large";
    }
  }

  if (!accepted) {
    return { accepted: false, dropReason, checks };
  }

  const emailId = randomUUID();
  const emailDate = new Date().toISOString();
  let status: string | null = null;
  let sessionId: string | null = null;
  let failReason: string | null = null;

  const attachmentRows: InboundEmailAttachment[] = (input.attachments ?? []).map((a) => ({
    attachment_id: randomUUID(),
    email_id: emailId,
    filename: a.filename || null,
    mime_type: a.mimeType || null,
    size_bytes: Number(a.sizeBytes) || null,
    content_base64: a.contentBase64 || null,
  }));

  if (resolved.addressRow) {
    const email: InboundEmail = {
      email_id: emailId,
      workspace_id: resolved.addressRow.workspace_id,
      from_email: resolved.fromEmail,
      from_name: resolved.fromName,
      to_address: to,
      subject: subject || null,
      date: emailDate,
      thread_id: null,
      size_bytes: totalBytes,
      status: "received",
      session_id: null,
      created_at: emailDate,
      entry: {
        textBody: textBody || undefined,
        htmlBody: htmlBody || undefined,
      },
    };

    await writeEmail(email);
    await writeAttachments(attachmentRows);

    try {
      await processInboundEmail(email, resolved.addressRow);
      const after = await getEmail(resolved.addressRow.workspace_id, emailId);
      status = after?.status ?? null;
      sessionId = after?.session_id ?? null;
      failReason = after?.fail_reason ?? null;
    } catch (err) {
      status = "failed";
      failReason = err instanceof Error ? err.message : String(err);
    }
  } else if (resolved.userAddressRow) {
    await writeUserInboundEmail({
      email_id: emailId,
      user_id: resolved.userAddressRow.user_id,
      from_email: resolved.fromEmail,
      from_name: resolved.fromName,
      to_address: to,
      subject: subject || null,
      date: emailDate,
      thread_id: null,
      size_bytes: totalBytes,
      entry: {
        textBody: textBody || undefined,
        htmlBody: htmlBody || undefined,
      },
    });
    await writeAttachments(attachmentRows);
    status = "received";
  }

  return {
    accepted: true,
    dropReason: null,
    checks,
    emailId,
    status,
    sessionId,
    failReason,
  };
}
