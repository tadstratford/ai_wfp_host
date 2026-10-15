-- Supabase Schema — General Ledger (system of record)
-- Run in your Supabase SQL Editor. Companion to docs/supabase-schema.sql.
-- Spec: docs/GL_SPEC.md
--
-- Conventions (match docs/supabase-schema.sql):
--   * IDs are TEXT, app- or DB-generated (gen_random_uuid()::text default).
--   * user_id is TEXT, FK → admin_users(user_id), ON DELETE CASCADE.
--   * Money is NUMERIC(18,2), single currency.
--   * App uses the service_role key, so RLS is not enforced; policies below are
--     documentation for any future API-key access.
--
-- Design notes:
--   * Balances are DERIVED from journal_lines (no trial_balances table).
--   * Opening balances are journals with source='opening'.
--   * global_accounts is a SHARED chart (no entity column) — consolidation is a
--     plain GROUP BY account.
--   * entity lives on the header (a journal belongs to one entity).
--   * journal_lines.amount is SIGNED (debit +, credit −) and is the reporting column.
--   * entity_id is a HARD FK (entities are controlled). account is a SOFT reference
--     (indexed, validated in app by api.gl.post) so messy imports fail with a
--     specific, actionable error rather than an opaque FK violation.
--   * Per-header balance (SUM(amount)=0) is enforced in app by post() validation,
--     not by a DB trigger. An integrity query is provided at the bottom.

-- ── entities ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_entities (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id          TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  code             TEXT NOT NULL,                 -- short handle, e.g. 'OPCO'
  name             TEXT NOT NULL,                 -- 'Acme Operating Co'
  is_primary       BOOLEAN NOT NULL DEFAULT false,-- the consolidation parent
  is_elimination   BOOLEAN NOT NULL DEFAULT false,-- holds elimination JEs
  parent_entity_id TEXT REFERENCES gl_entities(id) ON DELETE SET NULL,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code)
);

-- At most one primary / one elimination entity per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_entities_one_primary
  ON gl_entities(user_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gl_entities_one_elimination
  ON gl_entities(user_id) WHERE is_elimination;

-- ── global_accounts (shared chart of accounts) ──────────────────────────────
CREATE TABLE IF NOT EXISTS gl_global_accounts (
  user_id        TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  account        TEXT NOT NULL,                   -- primary identity, e.g. '7100-00 Rent Expense'
  account_type   TEXT,                            -- Income/Expense/Asset/Liability/Equity/...
  description    TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  account_number TEXT,
  account_name   TEXT,
  parent_account TEXT,                            -- for rollup subtotals (BS/P&L hierarchy)
  parent_number  TEXT,
  parent_name    TEXT,
  account_level  INTEGER,
  PRIMARY KEY (user_id, account)
);

-- ── journal_headers (the document; unit of balance validation) ───────────────
CREATE TABLE IF NOT EXISTS gl_journal_headers (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id           TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  entity_id         TEXT NOT NULL REFERENCES gl_entities(id),
  date              DATE NOT NULL,
  period            TEXT NOT NULL,                -- 'YYYY-MM', derived from date on post
  transaction_type  TEXT,                         -- 'Journal','Bill','Invoice',... (import)
  num               TEXT,                         -- document number / import group key
  name              TEXT,                         -- payee/vendor/customer at document level
  memo              TEXT,
  source            TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','import','opening','allocation','elimination')),
  source_session_id TEXT,                         -- provenance: run/session that posted it
  source_file       TEXT,                         -- import provenance
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gl_headers_entity_date
  ON gl_journal_headers(user_id, entity_id, date);
CREATE INDEX IF NOT EXISTS idx_gl_headers_period
  ON gl_journal_headers(user_id, period);
CREATE INDEX IF NOT EXISTS idx_gl_headers_session
  ON gl_journal_headers(source_session_id);

-- ── journal_lines ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_journal_lines (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  header_id TEXT NOT NULL REFERENCES gl_journal_headers(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  line_no   INTEGER NOT NULL,
  account   TEXT NOT NULL,                        -- soft ref → gl_global_accounts(user_id, account)
  class     TEXT,
  location  TEXT,
  vendor    TEXT,
  customer  TEXT,
  debit     NUMERIC(18,2),                        -- optional, import/display
  credit    NUMERIC(18,2),                        -- optional, import/display
  amount    NUMERIC(18,2) NOT NULL,               -- SIGNED: debit +, credit − (reporting column)
  memo      TEXT,
  UNIQUE (header_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_gl_lines_header  ON gl_journal_lines(header_id);
CREATE INDEX IF NOT EXISTS idx_gl_lines_account ON gl_journal_lines(user_id, account);

-- ── budgets (flat — not double-entry) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_budgets (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES admin_users(user_id) ON DELETE CASCADE,
  account     TEXT NOT NULL,                      -- soft ref → gl_global_accounts(user_id, account)
  period      TEXT NOT NULL,                      -- 'YYYY-MM'
  amount      NUMERIC(18,2) NOT NULL,
  class       TEXT,
  location    TEXT,
  entity_id   TEXT REFERENCES gl_entities(id) ON DELETE SET NULL,
  source_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_gl_budgets_lookup
  ON gl_budgets(user_id, account, period);

-- ── Row Level Security (documentation; service_role bypasses) ────────────────
ALTER TABLE gl_entities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_global_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_journal_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_budgets         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on gl_entities"        ON gl_entities        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on gl_global_accounts" ON gl_global_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on gl_journal_headers" ON gl_journal_headers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on gl_journal_lines"   ON gl_journal_lines   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on gl_budgets"         ON gl_budgets         FOR ALL USING (true) WITH CHECK (true);

-- ── Integrity check — headers whose lines don't net to zero ─────────────────
-- Run periodically. Should always return zero rows if post() validation holds.
--   SELECT h.id, h.num, h.date, SUM(l.amount) AS net
--   FROM gl_journal_headers h
--   JOIN gl_journal_lines l ON l.header_id = h.id
--   GROUP BY h.id, h.num, h.date
--   HAVING ABS(SUM(l.amount)) > 0.005;

-- ── Reference query — derived trial balance (no stored table) ───────────────
--   SELECT l.account, SUM(l.amount) AS balance
--   FROM gl_journal_lines l
--   JOIN gl_journal_headers h ON l.header_id = h.id
--   WHERE h.user_id = :user_id
--     AND h.entity_id = ANY(:entity_ids)   -- consolidated = primary + subs (+ elimination)
--     AND h.date <= :as_of
--   GROUP BY l.account
--   ORDER BY l.account;
