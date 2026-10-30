-- SQLite schema for the self-host (DB_BACKEND=sqlite) backend.
--
-- Human-readable reference. The canonical runtime DDL lives in
-- src/server/admin/sqliteSchema.ts (applied on boot via db.exec); keep the two
-- in sync. This mirrors schema/supabase-schema.sql with:
--   TIMESTAMPTZ → TEXT, JSONB → TEXT (JSON-encoded by the adapter), BOOLEAN → INTEGER.
--
-- SQLite has no `ADD COLUMN IF NOT EXISTS`, so the rollout ALTERs are folded
-- into a single clean CREATE TABLE per table.

-- ── admin_users ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  user_id                TEXT PRIMARY KEY,
  auth_user_id           TEXT UNIQUE,
  user_name              TEXT NOT NULL,
  user_email             TEXT UNIQUE NOT NULL,
  user_admin_flag        INTEGER DEFAULT 1,
  database_id            TEXT UNIQUE,
  workspace_name         TEXT DEFAULT 'My Workspace',
  dashboard_chat_history TEXT,
  dark_mode              INTEGER DEFAULT 1,
  persona_markdown       TEXT,
  user_persona_chat_history TEXT,
  current_session_id     TEXT,
  current_workflow_id    TEXT,
  current_chat_mode      TEXT DEFAULT 'build',
  chat_verbose           INTEGER DEFAULT 1,
  encrypted_llm_api_key  TEXT,
  encrypted_secrets      TEXT,
  llm_provider           TEXT DEFAULT 'anthropic',
  llm_model              TEXT DEFAULT 'claude-sonnet-4-6',
  skills_enabled         TEXT,
  nav_enabled            TEXT,
  password_hash          TEXT,
  last_login             TEXT,
  credit_balance_usd     REAL DEFAULT 0,
  created_at             TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── llm_usage ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_usage (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES admin_users(user_id),
  provider      TEXT NOT NULL DEFAULT 'anthropic',
  model         TEXT NOT NULL,
  source        TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      REAL,
  success       INTEGER DEFAULT 1,
  error_message TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created ON llm_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_cost ON llm_usage(user_id, cost_usd);

-- ── user_activity ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_activity (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES admin_users(user_id),
  user_email TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_created ON user_activity(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity(action, created_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_email ON user_activity(user_email, created_at);

-- ── workspaces ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id      TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  secret_hint       TEXT,
  description       TEXT,
  enc_metadata      TEXT NOT NULL,
  enc_workflows     TEXT NOT NULL,
  enc_tools         TEXT,
  enc_data          TEXT,
  enc_knowledge     TEXT,
  enc_sessions      TEXT,
  enc_logs          TEXT,
  enc_misc          TEXT,
  enc_provenance    TEXT,
  enc_privacy_mask  TEXT,
  enc_diary         TEXT,
  created_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_workspaces_user_updated ON workspaces(user_id, updated_at DESC);

-- ── shared_workflows ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_workflows (
  uuid                    TEXT PRIMARY KEY,
  sender_name             TEXT NOT NULL,
  workspace_name          TEXT NOT NULL,
  encrypted_content       TEXT NOT NULL,
  preview_workflow_count  INTEGER DEFAULT 0,
  preview_tool_count      INTEGER DEFAULT 0,
  preview_data_file_count INTEGER DEFAULT 0,
  description             TEXT,
  is_example              INTEGER DEFAULT 0,
  created_at              TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_workflows_expires ON shared_workflows(expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_workflows_examples ON shared_workflows(is_example) WHERE is_example = 1;

-- ── site_visits ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_visits (
  id         TEXT PRIMARY KEY,
  page       TEXT NOT NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_site_visits_page_created ON site_visits(page, created_at);
CREATE INDEX IF NOT EXISTS idx_site_visits_created ON site_visits(created_at);

-- ── inbound_email_addresses ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_email_addresses (
  address_key         TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  database_id         TEXT,
  secret_encrypted    TEXT NOT NULL,
  allowlisted_senders TEXT DEFAULT '[]',
  outbound_allowlist  TEXT DEFAULT '[]',
  enabled             INTEGER DEFAULT 1,
  created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_inbound_addr_workspace ON inbound_email_addresses(workspace_id);

-- ── user_email_addresses ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_email_addresses (
  address_key         TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  secret_encrypted    TEXT NOT NULL,
  allowlisted_senders TEXT DEFAULT '[]',
  outbound_allowlist  TEXT DEFAULT '[]',
  enabled             INTEGER DEFAULT 1,
  created_at          TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_user_addr_user ON user_email_addresses(user_id);

-- ── inbound_emails ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_emails (
  email_id      TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  from_email    TEXT,
  from_name     TEXT,
  to_address    TEXT,
  subject       TEXT,
  date          TEXT,
  thread_id     TEXT,
  size_bytes    INTEGER,
  status        TEXT DEFAULT 'received',
  session_id    TEXT,
  fail_reason   TEXT,
  user_id       TEXT,
  workflow_id   TEXT,
  workflow_name TEXT,
  skill_name    TEXT,
  audit_verdict TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  entry         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_workspace_created
  ON inbound_emails(workspace_id, created_at DESC, email_id DESC);

-- ── inbound_email_attachments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_email_attachments (
  attachment_id  TEXT PRIMARY KEY,
  email_id       TEXT NOT NULL REFERENCES inbound_emails(email_id) ON DELETE CASCADE,
  filename       TEXT,
  mime_type      TEXT,
  size_bytes     INTEGER,
  content_base64 TEXT
);
CREATE INDEX IF NOT EXISTS idx_inbound_attachments_email ON inbound_email_attachments(email_id);

-- ── outbound_emails ──────────────────────────────────────────────────────────
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
  workflow_id   TEXT,
  workflow_name TEXT,
  status        TEXT DEFAULT 'sent',
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_outbound_emails_workspace_created
  ON outbound_emails(workspace_id, created_at DESC, email_id DESC);

-- ── server allowlists ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS server_outbound_allowlist (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS server_inbound_allowlist (
  email      TEXT PRIMARY KEY,
  added_by   TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── workspace_workflows ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_workflows (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workflow_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  group_name   TEXT,
  updated_at   TEXT,
  PRIMARY KEY (workspace_id, workflow_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_workflows_workspace ON workspace_workflows(workspace_id);

-- ── workspace_content ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_content (
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  enc_content  TEXT NOT NULL,
  created_at   TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_workspace_content_workspace ON workspace_content(workspace_id);

-- ── workspace_grants ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_grants (
  grant_id         TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  workflow_id      TEXT NOT NULL,
  workflow_name    TEXT,
  owner_user_id    TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  owner_email      TEXT NOT NULL,
  grantee_email    TEXT NOT NULL,
  grantee_user_id  TEXT REFERENCES admin_users(user_id) ON DELETE SET NULL,
  created_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_accessed_at TEXT,
  access_count     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_workspace_grants_workspace ON workspace_grants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_grants_grantee ON workspace_grants(grantee_user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_grants_owner ON workspace_grants(owner_user_id);

-- ── signup_allowlist ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signup_allowlist (
  email      TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'allowed',
  notes      TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ── beta_codes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_codes (
  code            TEXT PRIMARY KEY,
  credit_usd      REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'unused',
  used_by_user_id TEXT REFERENCES admin_users(user_id),
  used_at         TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_beta_codes_status ON beta_codes(status);
