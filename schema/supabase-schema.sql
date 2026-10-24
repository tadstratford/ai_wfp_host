-- Supabase Schema for Workflow People
-- Run this in your Supabase SQL Editor to create the required tables.

-- ── admin_users ─────────────────────────────────────────────────────────────
-- Mirrors the former SQLite admin_users table.
-- One row per user. Permanent.

CREATE TABLE IF NOT EXISTS admin_users (
  user_id TEXT PRIMARY KEY,
  auth_user_id TEXT UNIQUE,
  user_name TEXT NOT NULL,
  user_email TEXT UNIQUE NOT NULL,
  user_admin_flag INTEGER DEFAULT 1,
  database_id TEXT UNIQUE,
  workspace_name TEXT DEFAULT 'My Workspace',
  dashboard_chat_history TEXT,
  dark_mode INTEGER DEFAULT 1,
  persona_markdown TEXT,
  user_persona_chat_history TEXT,
  current_session_id TEXT,
  current_workflow_id TEXT,
  current_chat_mode TEXT DEFAULT 'build',
  chat_verbose INTEGER DEFAULT 1,
  encrypted_llm_api_key TEXT,
  encrypted_secrets TEXT,
  llm_provider TEXT DEFAULT 'anthropic',
  llm_model TEXT DEFAULT 'claude-sonnet-4-6',
  skills_enabled TEXT,
  nav_enabled TEXT,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Added after initial rollout for per-user skill-group filtering; idempotent
-- for deployments that already created admin_users without this column.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS skills_enabled TEXT;

-- Added for per-user navigation visibility (JSON array of nav keys); idempotent.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS nav_enabled TEXT;

-- Added for per-user chat verbosity toggle (1 = show process details, 0 = quiet); idempotent.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS chat_verbose INTEGER DEFAULT 1;

-- Added for AUTH=password (enterprise self-host). bcrypt hash (Bun.password),
-- written only via userManager.setPasswordHash / scripts/reset-password.ts.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- ── llm_usage ───────────────────────────────────────────────────────────────
-- Centralized LLM usage tracking. Buffered writes from the server.
-- Used for rate limiting, cost tracking, and future billing.

CREATE TABLE IF NOT EXISTS llm_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES admin_users(user_id),
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL,
  source TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  success INTEGER DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rate limiting queries (calls per user in time window)
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created ON llm_usage(user_id, created_at);

-- Index for cost reporting by user
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_cost ON llm_usage(user_id, cost_usd);

-- ── user_activity ──────────────────────────────────────────────────────────
-- Tracks user actions for visibility into what users are doing.
-- Buffered writes from the server, similar to llm_usage.

CREATE TABLE IF NOT EXISTS user_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES admin_users(user_id),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying recent activity by user
CREATE INDEX IF NOT EXISTS idx_user_activity_user_created ON user_activity(user_id, created_at);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action, created_at);

-- Index for querying by email (quick lookup without join)
CREATE INDEX IF NOT EXISTS idx_user_activity_email ON user_activity(user_email, created_at);

-- ── workspaces ───────────────────────────────────────────────────────────────
-- Primary workspace storage. One row per workspace, holding the .wfp document
-- as PER-SECTION encrypted columns (AES-256-GCM envelopes derived from the
-- user's per-workspace secret word). The secret is NEVER stored — losing it
-- loses the workspace permanently. `name` is a plaintext cache of
-- `metadata.workspace` so the list page can render without decrypting.
-- `secret_hint` is optional user-entered text; treat it as visible to anyone
-- with the user's login. Sections are stored plaintext only while a workspace
-- has no secret (shareable); encrypted workspaces encrypt every section.

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id   TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  secret_hint    TEXT,
  description    TEXT,
  enc_metadata   TEXT NOT NULL,
  enc_workflows  TEXT NOT NULL,
  enc_tools      TEXT,
  enc_data       TEXT,
  enc_knowledge  TEXT,
  enc_sessions   TEXT,
  enc_logs       TEXT,
  enc_misc       TEXT,
  enc_provenance TEXT,
  enc_privacy_mask TEXT,
  enc_diary TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Added after initial rollout for the company-page client cards; idempotent for
-- deployments that already created the table without this column.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT;

-- ── Non-destructive migration to the per-section column format ──────────────
-- Deployments created before the section-column format have a single
-- `encrypted_blob` column instead of `enc_*`. Add the new columns (idempotent)
-- and relax the legacy blob so new rows can be written without it. Existing
-- rows are left as-is (their enc_* columns remain NULL and are not openable —
-- see test-data note).

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_metadata TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_workflows TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_tools TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_data TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_knowledge TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_sessions TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_logs TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_misc TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_provenance TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_privacy_mask TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS enc_diary TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspaces' AND column_name = 'encrypted_blob'
  ) THEN
    ALTER TABLE workspaces ALTER COLUMN encrypted_blob DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workspaces_user_updated
  ON workspaces(user_id, updated_at DESC);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on workspaces" ON workspaces;
CREATE POLICY "Service role full access on workspaces" ON workspaces
  FOR ALL USING (true) WITH CHECK (true);

-- ── shared_workflows ─────────────────────────────────────────────────────────
-- Stores encrypted shared workflow files. Replaces filesystem storage so
-- shares survive stateless deploys (Render). Auto-expires after 5 days.

CREATE TABLE IF NOT EXISTS shared_workflows (
  uuid TEXT PRIMARY KEY,
  sender_name TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  encrypted_content TEXT NOT NULL,
  preview_workflow_count INTEGER DEFAULT 0,
  preview_tool_count INTEGER DEFAULT 0,
  preview_data_file_count INTEGER DEFAULT 0,
  description TEXT,
  is_example BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup job (excludes examples)
CREATE INDEX IF NOT EXISTS idx_shared_workflows_expires ON shared_workflows(expires_at);
-- Index for listing examples
CREATE INDEX IF NOT EXISTS idx_shared_workflows_examples ON shared_workflows(is_example) WHERE is_example = true;

-- ── site_visits ────────────────────────────────────────────────────────────
-- Lightweight page view tracking for public pages.
-- No user IDs or referrers — just page + timestamp.

CREATE TABLE IF NOT EXISTS site_visits (
  id TEXT PRIMARY KEY,
  page TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for reporting by page and time
CREATE INDEX IF NOT EXISTS idx_site_visits_page_created ON site_visits(page, created_at);
CREATE INDEX IF NOT EXISTS idx_site_visits_created ON site_visits(created_at);

ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on site_visits" ON site_visits;
CREATE POLICY "Service role full access on site_visits" ON site_visits
  FOR ALL USING (true) WITH CHECK (true);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- The app uses a service_role key, so RLS is not enforced.
-- These policies are here as documentation for future API-key-based access.

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (this is the default for service_role key)
DROP POLICY IF EXISTS "Service role full access on admin_users" ON admin_users;
CREATE POLICY "Service role full access on admin_users" ON admin_users
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on llm_usage" ON llm_usage;
CREATE POLICY "Service role full access on llm_usage" ON llm_usage
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on user_activity" ON user_activity;
CREATE POLICY "Service role full access on user_activity" ON user_activity
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE shared_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on shared_workflows" ON shared_workflows;
CREATE POLICY "Service role full access on shared_workflows" ON shared_workflows
  FOR ALL USING (true) WITH CHECK (true);

-- ── inbound_email_addresses ──────────────────────────────────────────────────
-- One row per workspace inbox. `address_key` is a short slug that identifies
-- the workspace in the inbound address (`wf-<key>.<secret>@domain`); `secret`
-- authenticates the sender and is stored AES-256-GCM encrypted with APP_SECRET
-- (never plaintext) so the Settings UI can re-display the full address. The
-- allowlist is a JSON array of normalized From emails.
-- Deleted automatically when the workspace row is deleted (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS inbound_email_addresses (
  address_key        TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  database_id        TEXT,
  secret_encrypted   TEXT NOT NULL,
  allowlisted_senders JSONB DEFAULT '[]'::jsonb,
  outbound_allowlist JSONB DEFAULT '[]'::jsonb,
  enabled            BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbound_addr_workspace
  ON inbound_email_addresses(workspace_id);

ALTER TABLE inbound_email_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on inbound_email_addresses" ON inbound_email_addresses;
CREATE POLICY "Service role full access on inbound_email_addresses" ON inbound_email_addresses
  FOR ALL USING (true) WITH CHECK (true);

-- ── user_email_addresses ─────────────────────────────────────────────────────
-- One row per USER inbox (company-level, not workspace-scoped). Address format
-- `<slug>.<secret>@domain` (e.g. jane.smith.43b2u@…); the secret authenticates
-- the sender. Inbound mail to a user address is archive-only (no workflow
-- trigger). Deleted automatically when the user row is deleted.

CREATE TABLE IF NOT EXISTS user_email_addresses (
  address_key        TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  secret_encrypted   TEXT NOT NULL,
  allowlisted_senders JSONB DEFAULT '[]'::jsonb,
  outbound_allowlist JSONB DEFAULT '[]'::jsonb,
  enabled            BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_addr_user
  ON user_email_addresses(user_id);

ALTER TABLE user_email_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on user_email_addresses" ON user_email_addresses;
CREATE POLICY "Service role full access on user_email_addresses" ON user_email_addresses
  FOR ALL USING (true) WITH CHECK (true);

-- ── inbound_emails ───────────────────────────────────────────────────────────
-- Archived inbound emails, modeled on llm_logs: flattened columns for
-- filtering/retention plus a JSONB `entry` for the full text/html body and
-- headers. Capped at p_max_emails per workspace (enforced by the
-- append_inbound_email function below). Never written into the .wfp blob.

CREATE TABLE IF NOT EXISTS inbound_emails (
  email_id      TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  from_email    TEXT,
  from_name     TEXT,
  to_address    TEXT,
  subject       TEXT,
  date          TIMESTAMPTZ,
  thread_id     TEXT,
  size_bytes    INTEGER,
  status        TEXT DEFAULT 'received',
  session_id    TEXT,
  fail_reason   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  entry         JSONB NOT NULL
);

-- Added after initial rollout for the "failed" status; idempotent for
-- deployments that already created the table without this column.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS fail_reason TEXT;

-- Added for user-level (company) mail: user emails have no workspace, so
-- workspace_id becomes nullable and user_id identifies the owner.
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE inbound_emails ALTER COLUMN workspace_id DROP NOT NULL;

-- Added for workflow tagging: the email agent records the workflow it routed
-- the email to (id/name/skill at routing time) and the audit verdict (after run).
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS workflow_name TEXT;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS skill_name TEXT;
ALTER TABLE inbound_emails ADD COLUMN IF NOT EXISTS audit_verdict TEXT;

CREATE INDEX IF NOT EXISTS idx_inbound_emails_workspace_created
  ON inbound_emails(workspace_id, created_at DESC, email_id DESC);

ALTER TABLE inbound_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on inbound_emails" ON inbound_emails;
CREATE POLICY "Service role full access on inbound_emails" ON inbound_emails
  FOR ALL USING (true) WITH CHECK (true);

-- ── inbound_email_attachments ────────────────────────────────────────────────
-- Attachments stored separately (base64) so the email `entry` JSONB stays small.

CREATE TABLE IF NOT EXISTS inbound_email_attachments (
  attachment_id  TEXT PRIMARY KEY,
  email_id       TEXT NOT NULL REFERENCES inbound_emails(email_id) ON DELETE CASCADE,
  filename       TEXT,
  mime_type      TEXT,
  size_bytes     INTEGER,
  content_base64 TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbound_attachments_email
  ON inbound_email_attachments(email_id);

ALTER TABLE inbound_email_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on inbound_email_attachments" ON inbound_email_attachments;
CREATE POLICY "Service role full access on inbound_email_attachments" ON inbound_email_attachments
  FOR ALL USING (true) WITH CHECK (true);

-- Insert one email and prune the workspace down to `p_max_emails` newest rows in
-- a single atomic operation. Idempotent on `email_id` (retried writes no-op).
--
-- `p_fail_reason` was added later. CREATE OR REPLACE cannot change an existing
-- function's argument types, so drop the pre-fail_reason signature first to
-- avoid leaving a stale overload behind (and a PostgREST schema-cache 404).
DROP FUNCTION IF EXISTS append_inbound_email(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT,
  TIMESTAMPTZ, JSONB, INTEGER
) CASCADE;

CREATE OR REPLACE FUNCTION append_inbound_email(
  p_email_id      TEXT,
  p_workspace_id  TEXT,
  p_from_email    TEXT,
  p_from_name     TEXT,
  p_to_address    TEXT,
  p_subject       TEXT,
  p_date          TIMESTAMPTZ,
  p_thread_id     TEXT,
  p_size_bytes    INTEGER,
  p_status        TEXT,
  p_fail_reason   TEXT,
  p_created_at    TIMESTAMPTZ,
  p_entry         JSONB,
  p_max_emails    INTEGER DEFAULT 200
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining INTEGER;
BEGIN
  INSERT INTO inbound_emails (
    email_id, workspace_id, from_email, from_name, to_address, subject,
    date, thread_id, size_bytes, status, fail_reason, created_at, entry
  ) VALUES (
    p_email_id, p_workspace_id, p_from_email, p_from_name, p_to_address, p_subject,
    p_date, p_thread_id, p_size_bytes, p_status, p_fail_reason, p_created_at, p_entry
  )
  ON CONFLICT (email_id) DO NOTHING;

  DELETE FROM inbound_emails
  WHERE workspace_id = p_workspace_id
    AND email_id NOT IN (
      SELECT email_id
      FROM inbound_emails
      WHERE workspace_id = p_workspace_id
      ORDER BY created_at DESC, email_id DESC
      LIMIT p_max_emails
    );

  SELECT COUNT(*) INTO v_remaining FROM inbound_emails WHERE workspace_id = p_workspace_id;
  RETURN v_remaining;
END;
$$;

-- ── outbound_emails ──────────────────────────────────────────────────────────
-- Outbound (sent) emails, recorded by the "Emails" send tools so the Sent view
-- can list them. Never written into the .wfp blob.

CREATE TABLE IF NOT EXISTS outbound_emails (
  email_id      TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id       TEXT,
  to_email      TEXT,
  to_name       TEXT,
  cc            TEXT,
  subject       TEXT,
  body_text     TEXT,
  body_html     TEXT,
  reply_to      TEXT,
  in_reply_to   TEXT,
  status        TEXT DEFAULT 'sent',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_emails_workspace_created
  ON outbound_emails(workspace_id, created_at DESC, email_id DESC);

-- Added after initial rollout for reply correlation; idempotent for deployments
-- that already created the table without this column.
ALTER TABLE outbound_emails ADD COLUMN IF NOT EXISTS in_reply_to TEXT;

-- Added for user-level (company) mail: user sends have no workspace, so
-- workspace_id becomes nullable and user_id identifies the author.
ALTER TABLE outbound_emails ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE outbound_emails ALTER COLUMN workspace_id DROP NOT NULL;

-- Added for workflow tagging of outbound replies (set by the email agent).
ALTER TABLE outbound_emails ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE outbound_emails ADD COLUMN IF NOT EXISTS workflow_name TEXT;

ALTER TABLE outbound_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on outbound_emails" ON outbound_emails;
CREATE POLICY "Service role full access on outbound_emails" ON outbound_emails
  FOR ALL USING (true) WITH CHECK (true);

-- ── server_outbound_allowlist ────────────────────────────────────────────────
-- Server-instance-wide OUTBOUND allowlist. Fail-closed: an EMPTY list DENIES all
-- outbound email. Every external recipient (to/cc) must be listed here IN
-- ADDITION to the per-workspace `outbound_allowlist`. Protects against sending
-- to stale addresses (former clients / ex-associates). Managed by the admin.

CREATE TABLE IF NOT EXISTS server_outbound_allowlist (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE server_outbound_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on server_outbound_allowlist" ON server_outbound_allowlist;
CREATE POLICY "Service role full access on server_outbound_allowlist" ON server_outbound_allowlist
  FOR ALL USING (true) WITH CHECK (true);

-- ── server_inbound_allowlist ─────────────────────────────────────────────────
-- Server-instance-wide INBOUND allowlist. Fail-closed: an EMPTY list DENIES all
-- inbound email. Every external sender must be listed here IN ADDITION to the
-- per-workspace `allowlisted_senders`. Managed by the admin.

CREATE TABLE IF NOT EXISTS server_inbound_allowlist (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE server_inbound_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on server_inbound_allowlist" ON server_inbound_allowlist;
CREATE POLICY "Service role full access on server_inbound_allowlist" ON server_inbound_allowlist
  FOR ALL USING (true) WITH CHECK (true);

-- ── workspace_workflows ──────────────────────────────────────────────────────
-- Plaintext cache of each workspace's workflow names (id → name → nav group),
-- written on save/open so the Home page can list workflows across workspaces
-- without opening (decrypting) them. Kept in sync by workspaceStore
-- saveWorkspace/createWorkspace via workflowIndex.ts. Replaced wholesale on
-- each sync (a few rows). Deleted automatically when the workspace row is
-- deleted (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS workspace_workflows (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workflow_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  group_name    TEXT,
  updated_at    TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflows_workspace
  ON workspace_workflows(workspace_id);

ALTER TABLE workspace_workflows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on workspace_workflows" ON workspace_workflows;
CREATE POLICY "Service role full access on workspace_workflows" ON workspace_workflows
  FOR ALL USING (true) WITH CHECK (true);

-- ── workspace_content ─────────────────────────────────────────────────────────
-- Content-addressed store of historical node versions for the "Time Machine".
-- The provenance ledger records `newContentHash` (SHA-256 of the node's
-- plaintext JSON); the actual historical payload lives here, keyed by that
-- hash, so past values can be reconstructed for diffs and "reopen as of X".
-- Encrypted with the same workspace secret when the workspace is private
-- (plaintext when shared, matching the main workspaces sections). Deduped by
-- (workspace_id, content_hash). Deleted automatically with the workspace row.

CREATE TABLE IF NOT EXISTS workspace_content (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  enc_content   TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (workspace_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_workspace_content_workspace
  ON workspace_content(workspace_id);

ALTER TABLE workspace_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on workspace_content" ON workspace_content;
CREATE POLICY "Service role full access on workspace_content" ON workspace_content
  FOR ALL USING (true) WITH CHECK (true);


-- ── workspace_grants ──────────────────────────────────────────────────────────
-- Server-readable access grants for shared workflows/workspaces. A grant lets
-- one other user (by email) view a single workflow — or a whole workspace —
-- read-only. Grants are the source of truth for access: revoke = delete the
-- row. The owner's workspace secret is still required to decrypt; the grant
-- only authorizes the fetch, it never stores the secret.
--
-- `workflow_id = '*'` (WORKSPACE_SCOPE) marks a whole-workspace share.
-- Denormalized owner_email / workflow_name so the eq-only Supabase REST wrapper
-- can render lists without joins. `grantee_user_id` is NULL until an invite is
-- claimed (see workflowGrants.ts claimGrants).
--
-- Renamed from workflow_grants → workspace_grants (whole-workspace sharing);
-- see src/workspace/workflowGrants.ts.

CREATE TABLE IF NOT EXISTS workspace_grants (
  grant_id         TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workflow_id      TEXT NOT NULL,
  workflow_name    TEXT,
  owner_user_id    TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  owner_email      TEXT NOT NULL,
  grantee_email    TEXT NOT NULL,
  grantee_user_id  TEXT REFERENCES admin_users(user_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  access_count     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workspace_grants_workspace
  ON workspace_grants(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_grants_grantee
  ON workspace_grants(grantee_user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_grants_owner
  ON workspace_grants(owner_user_id);

ALTER TABLE workspace_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on workspace_grants" ON workspace_grants;
CREATE POLICY "Service role full access on workspace_grants" ON workspace_grants
  FOR ALL USING (true) WITH CHECK (true);

-- ── signup_allowlist ────────────────────────────────────────────────────────
-- Who may create an account. Sign-in (Google OAuth or magic link) is gated on
-- this list: an email not present here can still authenticate with Google but
-- is never created in admin_users. Maintained by the operator via
-- scripts/manage-allowlist.ts. Separate concern from beta_codes (credit).

CREATE TABLE IF NOT EXISTS signup_allowlist (
  email      TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'allowed', -- 'allowed' | 'revoked'
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE signup_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on signup_allowlist" ON signup_allowlist;
CREATE POLICY "Service role full access on signup_allowlist" ON signup_allowlist
  FOR ALL USING (true) WITH CHECK (true);

-- ── beta_codes ──────────────────────────────────────────────────────────────
-- Single-use beta codes. Redeeming one credits the user's account. Codes are
-- generated out-of-band (see scripts/generate-beta-codes.ts) and handed to
-- beta users manually. No billing is attached — this is a credit pool only.

CREATE TABLE IF NOT EXISTS beta_codes (
  code            TEXT PRIMARY KEY,
  credit_usd      REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'unused', -- 'unused' | 'used' | 'revoked'
  used_by_user_id TEXT REFERENCES admin_users(user_id),
  used_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beta_codes_status ON beta_codes(status);

ALTER TABLE beta_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on beta_codes" ON beta_codes;
CREATE POLICY "Service role full access on beta_codes" ON beta_codes
  FOR ALL USING (true) WITH CHECK (true);

-- Total credit granted to a user (running balance incremented on redemption).
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS credit_balance_usd REAL DEFAULT 0;

-- Atomically redeem a code: mark it used and credit the user in one transaction.
-- Returns a JSON object so the result is never NULL:
--   { "ok": true,  "credit_usd": 15 }
--   { "ok": false, "error": "invalid" | "already_used" }
CREATE OR REPLACE FUNCTION redeem_beta_code(p_code TEXT, p_user_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_credit REAL;
BEGIN
  UPDATE beta_codes
     SET status = 'used', used_by_user_id = p_user_id, used_at = NOW()
   WHERE code = p_code AND status = 'unused'
  RETURNING credit_usd INTO v_credit;

  IF v_credit IS NULL THEN
    IF EXISTS (SELECT 1 FROM beta_codes WHERE code = p_code) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_used');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  UPDATE admin_users
     SET credit_balance_usd = COALESCE(credit_balance_usd, 0) + v_credit
   WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'credit_usd', v_credit);
END;
$$;

-- Current credit status for a user: granted balance vs. amount spent (USD).
CREATE OR REPLACE FUNCTION credit_status(p_user_id TEXT)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_balance REAL;
  v_used REAL;
BEGIN
  SELECT COALESCE(credit_balance_usd, 0) INTO v_balance
    FROM admin_users WHERE user_id = p_user_id;
  SELECT COALESCE(SUM(cost_usd), 0) INTO v_used
    FROM llm_usage WHERE user_id = p_user_id AND success = 1;
  RETURN jsonb_build_object('balance', v_balance, 'used', v_used);
END;
$$;

-- Usage time-buckets for the /app/user analytics panel.
-- Groups successful LLM calls into day/month buckets, further grouped by model,
-- returning spend, tokens, and request counts per (bucket, model).
CREATE OR REPLACE FUNCTION usage_buckets(
  p_user_id TEXT,
  p_granularity TEXT DEFAULT 'day',
  p_since TIMESTAMPTZ DEFAULT NULL,
  p_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  bucket TIMESTAMPTZ,
  model TEXT,
  cost_usd REAL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  requests BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    date_trunc(p_granularity, created_at) AS bucket,
    model,
    SUM(cost_usd) AS cost_usd,
    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
    COUNT(*) AS requests
  FROM llm_usage
  WHERE user_id = p_user_id
    AND success = 1
    AND (p_since IS NULL OR created_at >= p_since)
    AND (p_until IS NULL OR created_at < p_until)
  GROUP BY bucket, model
  ORDER BY bucket, model;
$$;
