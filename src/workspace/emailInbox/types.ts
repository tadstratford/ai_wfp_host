// Inbound email types — Supabase-backed inbox, modeled on the LLM logs tables.
// None of this lives in the .wfp document; it is keyed to a workspace_id.

export interface InboundAddress {
  address_key: string;
  workspace_id: string;
  user_id: string;
  database_id: string | null;
  secret_encrypted: string;
  allowlisted_senders: string[];
  outbound_allowlist: string[];
  enabled: boolean;
  created_at: string;
}

// Single source of truth for the email status vocabulary. `EmailStatus` is
// derived from `EMAIL_STATUSES` so the two can never drift. Import
// `EMAIL_STATUSES` (not a local copy) anywhere a status enum is needed.
export const EMAIL_STATUSES = [
  "received",
  "read",
  "in_progress",
  "processed",
  "archived",
  "deleted",
  "failed",
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export interface OutboundEmail {
  email_id: string;
  workspace_id: string | null;
  user_id?: string | null;
  to_email: string | null;
  to_name: string | null;
  cc: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  reply_to: string | null;
  /** Internal id of the inbound email this reply answers (NULL for new sends). */
  in_reply_to: string | null;
  /** Workflow that authored this reply (set for gated replies). */
  workflow_id?: string | null;
  workflow_name?: string | null;
  status: string | null;
  created_at: string;
}

export interface InboundEmailAttachment {
  attachment_id: string;
  email_id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  content_base64: string | null;
}

export interface InboundEmail {
  email_id: string;
  workspace_id: string;
  from_email: string | null;
  from_name: string | null;
  to_address: string | null;
  subject: string | null;
  date: string | null;
  thread_id: string | null;
  size_bytes: number | null;
  status: EmailStatus | null;
  session_id: string | null;
  /** Workflow the email agent routed this to (set at routing time). */
  workflow_id?: string | null;
  workflow_name?: string | null;
  /** Routing skill that mapped to the workflow. */
  skill_name?: string | null;
  /** Audit verdict persisted after execution (pass/fail). */
  audit_verdict?: string | null;
  fail_reason?: string | null;
  created_at: string;
  entry: InboundEmailEntry;
}

export interface InboundEmailEntry {
  textBody?: string;
  htmlBody?: string;
  headers?: Record<string, string>;
}
