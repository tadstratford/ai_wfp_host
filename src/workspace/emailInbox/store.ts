// inboundEmail/store — Supabase-backed CRUD for archived inbound emails,
// modeled on logs/supabaseStore.ts. Emails live OUTSIDE the .wfp blob.

import * as db from "../../server/admin/supabase";
import type { EmailStatus, InboundEmail, InboundEmailAttachment } from "./types";

const TABLE = "inbound_emails";
const ATTACHMENTS_TABLE = "inbound_email_attachments";
const APPEND_RPC = "append_inbound_email";

const COLS =
  "email_id,workspace_id,from_email,from_name,to_address,subject,date,thread_id,size_bytes,status,session_id,workflow_id,workflow_name,skill_name,audit_verdict,fail_reason,created_at,entry";

/** Hard cap on retained emails per workspace — matches `p_max_emails` in the
 *  `append_inbound_email` Postgres function (schema/supabase-schema.sql). */
export const MAX_EMAILS_PER_WORKSPACE = 200;

interface EmailRow {
  email_id: string;
  workspace_id: string;
  from_email: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  date: string | null;
  thread_id: string | null;
  size_bytes: number | null;
  status: string | null;
  session_id: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  skill_name: string | null;
  audit_verdict: string | null;
  fail_reason: string | null;
  created_at: string;
  entry: InboundEmail["entry"];
}

function mapRow(row: EmailRow): InboundEmail {
  return {
    email_id: row.email_id,
    workspace_id: row.workspace_id,
    from_email: row.from_email ?? null,
    from_name: row.from_name ?? null,
    to_address: row.to_address ?? null,
    subject: row.subject ?? null,
    date: row.date ?? null,
    thread_id: row.thread_id ?? null,
    size_bytes: row.size_bytes ?? null,
    status: (row.status as EmailStatus | null) ?? null,
    session_id: row.session_id ?? null,
    workflow_id: row.workflow_id ?? null,
    workflow_name: row.workflow_name ?? null,
    skill_name: row.skill_name ?? null,
    audit_verdict: row.audit_verdict ?? null,
    fail_reason: row.fail_reason ?? null,
    created_at: row.created_at,
    entry: row.entry ?? {},
  };
}

/**
 * Insert one email and prune the workspace down to MAX_EMAILS_PER_WORKSPACE
 * newest entries. Idempotent on `email_id`. Drops silently (like llm_logs) when
 * the workspace has no `workspaces` row (disk/plaintext backing).
 */
export async function writeEmail(email: InboundEmail): Promise<void> {
  const result = await db.rpc(APPEND_RPC, {
    p_email_id: email.email_id,
    p_workspace_id: email.workspace_id,
    p_from_email: email.from_email ?? null,
    p_from_name: email.from_name ?? null,
    p_to_address: email.to_address ?? null,
    p_subject: email.subject ?? null,
    p_date: email.date ?? null,
    p_thread_id: email.thread_id ?? null,
    p_size_bytes: email.size_bytes ?? null,
    p_status: email.status ?? "received",
    p_fail_reason: email.fail_reason ?? null,
    p_created_at: email.created_at ?? new Date().toISOString(),
    p_entry: email.entry ?? {},
    p_max_emails: MAX_EMAILS_PER_WORKSPACE,
  });
  if (result.error) {
    // 23503 = foreign_key_violation: no `workspaces` row (not Supabase-backed).
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to write inbound email: ${result.error}`);
  }
}

/** Insert a user-level inbound email (no workspace, archive-only). Written via
 *  a direct insert — no per-workspace prune, no agent trigger. */
export async function writeUserInboundEmail(record: {
  email_id: string;
  user_id: string;
  from_email: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  date: string | null;
  thread_id: string | null;
  size_bytes: number | null;
  entry: InboundEmail["entry"];
}): Promise<void> {
  const result = await db.insert(TABLE, {
    email_id: record.email_id,
    workspace_id: null,
    user_id: record.user_id,
    from_email: record.from_email,
    from_name: record.from_name,
    to_address: record.to_address,
    subject: record.subject,
    date: record.date,
    thread_id: record.thread_id,
    size_bytes: record.size_bytes,
    status: "received",
    fail_reason: null,
    created_at: new Date().toISOString(),
    entry: record.entry ?? {},
  });
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to write user inbound email: ${result.error}`);
  }
}

/** Insert attachment rows (base64 content). */
export async function writeAttachments(
  attachments: InboundEmailAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  const result = await db.insert(
    ATTACHMENTS_TABLE,
    attachments.map((a) => ({
      attachment_id: a.attachment_id,
      email_id: a.email_id,
      filename: a.filename ?? null,
      mime_type: a.mime_type ?? null,
      size_bytes: a.size_bytes ?? null,
      content_base64: a.content_base64 ?? null,
    })),
  );
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to write inbound attachments: ${result.error}`);
  }
}

/** List a workspace's archived emails, newest first. */
export async function listEmails(workspaceId: string): Promise<InboundEmail[]> {
  const result = await db.select<EmailRow>(TABLE, { workspace_id: workspaceId }, COLS);
  if (result.error) {
    throw new Error(`Failed to list inbound emails: ${result.error}`);
  }
  const rows = (result.data ?? []).map(mapRow);
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return rows;
}

/** Fetch a single email by id, scoped to the workspace. */
export async function getEmail(
  workspaceId: string,
  emailId: string,
): Promise<InboundEmail | null> {
  const result = await db.selectOne<EmailRow>(
    TABLE,
    { workspace_id: workspaceId, email_id: emailId },
    COLS,
  );
  if (result.error) {
    throw new Error(`Failed to load inbound email: ${result.error}`);
  }
  return result.data ? mapRow(result.data) : null;
}

/** List the attachments for a single email. */
export async function listAttachments(emailId: string): Promise<InboundEmailAttachment[]> {
  const result = await db.select<InboundEmailAttachment>(
    ATTACHMENTS_TABLE,
    { email_id: emailId },
    "attachment_id,email_id,filename,mime_type,size_bytes,content_base64",
  );
  if (result.error) {
    throw new Error(`Failed to list inbound attachments: ${result.error}`);
  }
  return result.data ?? [];
}

/** Fetch a single attachment (including base64 content) by id. */
export async function getAttachmentById(
  attachmentId: string,
): Promise<InboundEmailAttachment | null> {
  const result = await db.selectOne<InboundEmailAttachment>(
    ATTACHMENTS_TABLE,
    { attachment_id: attachmentId },
    "attachment_id,email_id,filename,mime_type,size_bytes,content_base64",
  );
  if (result.error) {
    throw new Error(`Failed to load inbound attachment: ${result.error}`);
  }
  return result.data ?? null;
}

/** Delete an email (attachments cascade at the DB level). */
export async function deleteEmail(emailId: string): Promise<void> {
  await db.del(TABLE, { email_id: emailId });
}

/** Set an email's processing status (PostgREST PATCH on `inbound_emails`).
 *  Optionally record a failure reason when the status is `failed`. */
export async function updateEmailStatus(
  emailId: string,
  status: EmailStatus,
  failReason?: string | null,
): Promise<void> {
  const result = await db.update(
    TABLE,
    { email_id: emailId },
    { status, fail_reason: failReason ?? null },
  );
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to update inbound email status: ${result.error}`);
  }
}

/** Link an inbound email to the chat session that processed it. */
export async function linkEmailSession(
  emailId: string,
  sessionId: string,
): Promise<void> {
  const result = await db.update(TABLE, { email_id: emailId }, { session_id: sessionId });
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to link inbound email session: ${result.error}`);
  }
}

/** Tag an inbound email with the workflow the agent routed it to (routing time). */
export async function tagEmailWorkflow(
  emailId: string,
  tags: { workflowId: string; workflowName: string; skillName?: string },
): Promise<void> {
  const result = await db.update(
    TABLE,
    { email_id: emailId },
    {
      workflow_id: tags.workflowId,
      workflow_name: tags.workflowName,
      ...(tags.skillName ? { skill_name: tags.skillName } : {}),
    },
  );
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to tag inbound email workflow: ${result.error}`);
  }
}

/** Persist the workflow audit verdict onto the email (post-execution). */
export async function setEmailAuditVerdict(
  emailId: string,
  verdict: string,
): Promise<void> {
  const result = await db.update(TABLE, { email_id: emailId }, { audit_verdict: verdict });
  if (result.error) {
    if (result.error.includes("23503")) return;
    throw new Error(`Failed to set inbound email audit verdict: ${result.error}`);
  }
}
