// sqlite — in-process SQLite datastore for the self-host (DB_BACKEND=sqlite)
// backend. Exposes the same select/selectOne/insert/upsert/update/del/rpc
// surface as the PostgREST adapter (src/server/admin/supabase.ts), returning
// the same `{ data, error }` result shape so callers are unchanged.
//
// Data lives in ONE file: dataRoot()/data/<instance>/workflowpeople.db, opened
// lazily on first use. WAL mode + a busy timeout make it safe for the single
// Bun process; foreign_keys=ON reproduces Postgres cascade/FK semantics.
//
// Only a handful of columns are JSON or BOOLEAN in Postgres and need
// serialization/hydration here; every other value is stored as-is. Encrypted
// workspace sections stay opaque strings (they are NOT JSON columns, so the
// `{...}` envelope JSON is never parsed).

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "@shared/dataRoot";
import { SQLITE_SCHEMA_DDL } from "./sqliteSchema";

export interface SqliteResult<T = any> {
  data: T | null;
  error: string | null;
}

type Filter = Record<string, string | number | boolean | null>;

// JSONB columns → stored as JSON-encoded TEXT; hydrated back to objects/arrays.
const JSON_COLUMNS: Record<string, string[]> = {
  inbound_email_addresses: ["allowlisted_senders", "outbound_allowlist"],
  user_email_addresses: ["allowlisted_senders", "outbound_allowlist"],
  inbound_emails: ["entry"],
};

// BOOLEAN columns → stored as INTEGER 0/1; hydrated back to booleans.
const BOOL_COLUMNS: Record<string, string[]> = {
  shared_workflows: ["is_example"],
  inbound_email_addresses: ["enabled"],
  user_email_addresses: ["enabled"],
};

// Primary keys per table — used by upsert (ON CONFLICT target).
const PRIMARY_KEYS: Record<string, string[]> = {
  admin_users: ["user_id"],
  llm_usage: ["id"],
  user_activity: ["id"],
  workspaces: ["workspace_id"],
  shared_workflows: ["uuid"],
  site_visits: ["id"],
  inbound_email_addresses: ["address_key"],
  user_email_addresses: ["address_key"],
  inbound_emails: ["email_id"],
  inbound_email_attachments: ["attachment_id"],
  outbound_emails: ["email_id"],
  server_outbound_allowlist: ["email"],
  server_inbound_allowlist: ["email"],
  workspace_workflows: ["workspace_id", "workflow_id"],
  workspace_content: ["workspace_id", "content_hash"],
  workspace_grants: ["grant_id"],
  signup_allowlist: ["email"],
  beta_codes: ["code"],
};

let db: Database | null = null;

export function dbFilePath(): string {
  const instance = (process.env.INSTANCE || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dataRoot(), "data", instance, "workflowpeople.db");
}

/** Open (or return the already-open) SQLite handle, migrating the schema. */
export function getDb(): Database {
  if (db) return db;
  const file = dbFilePath();
  mkdirSync(join(file, ".."), { recursive: true });
  db = new Database(file);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA foreign_keys = ON;");
  db.exec(SQLITE_SCHEMA_DDL);
  return db;
}

/** Force-open + migrate at startup (see src/server/index.tsx). */
export function initDbBackend(): void {
  getDb();
}

// ── Value normalization ──────────────────────────────────────────────────────

function normalizeValue(table: string, col: string, value: unknown): SQLQueryBindings {
  if (value === undefined) return null;
  const jsonCols = JSON_COLUMNS[table];
  if (jsonCols?.includes(col)) {
    if (value === null) return null;
    return typeof value === "object" ? JSON.stringify(value) : (value as SQLQueryBindings);
  }
  const boolCols = BOOL_COLUMNS[table];
  if (boolCols?.includes(col)) return value ? 1 : 0;
  return value as SQLQueryBindings;
}

function normalizeFilterValue(table: string, col: string, value: unknown): SQLQueryBindings {
  const boolCols = BOOL_COLUMNS[table];
  if (boolCols?.includes(col)) return value ? 1 : 0;
  return value as SQLQueryBindings;
}

function hydrateRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = { ...row };
  const jsonCols = JSON_COLUMNS[table];
  if (jsonCols) {
    for (const c of jsonCols) {
      const v = out[c];
      if (typeof v === "string") {
        try {
          out[c] = JSON.parse(v);
        } catch {
          /* leave as-is */
        }
      }
    }
  }
  const boolCols = BOOL_COLUMNS[table];
  if (boolCols) {
    for (const c of boolCols) {
      const v = out[c];
      out[c] = v === 1 || v === "1" || v === true;
    }
  }
  return out;
}

function buildWhere(table: string, filters: Filter): { sql: string; params: SQLQueryBindings[] } {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) {
      clauses.push(`${k} IS NULL`);
    } else {
      clauses.push(`${k} = ?`);
      params.push(normalizeFilterValue(table, k, v));
    }
  }
  return { sql: clauses.join(" AND "), params };
}

function columnList(columns?: string): string {
  if (!columns || columns === "*") return "*";
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .join(",");
}

/** Translate a SQLite foreign-key violation to the Postgres "23503" code so
 *  callers that swallow the "no parent row" case keep working. */
function normalizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/FOREIGN KEY/i.test(msg)) return `23503 foreign_key_violation: ${msg}`;
  return msg;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function select<T = any>(
  table: string,
  filters: Filter = {},
  columns?: string,
): Promise<SqliteResult<T[]>> {
  try {
    const d = getDb();
    const where = buildWhere(table, filters);
    const sql = `SELECT ${columnList(columns)} FROM ${table}${where.sql ? ` WHERE ${where.sql}` : ""}`;
    const rows = d.prepare(sql).all(...where.params) as Record<string, unknown>[];
    const data = rows.map((r) => hydrateRow(table, r)) as unknown as T[];
    return { data, error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

export async function selectOne<T = any>(
  table: string,
  filters: Filter,
  columns?: string,
): Promise<SqliteResult<T>> {
  try {
    const d = getDb();
    const where = buildWhere(table, filters);
    const sql = `SELECT ${columnList(columns)} FROM ${table}${where.sql ? ` WHERE ${where.sql}` : ""} LIMIT 1`;
    const row = d.prepare(sql).get(...where.params) as Record<string, unknown> | undefined;
    return { data: (row ? (hydrateRow(table, row) as unknown as T) : null), error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

export async function insert<T = any>(
  table: string,
  data: Record<string, any> | Record<string, any>[],
): Promise<SqliteResult<T[]>> {
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) return { data: [] as T[], error: null };
  try {
    const d = getDb();
    const cols = Object.keys(list[0]);
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`;
    const stmt = d.prepare(sql);
    const tx = d.transaction((rows: Record<string, any>[]) => {
      for (const r of rows) stmt.run(...cols.map((c) => normalizeValue(table, c, r[c])));
    });
    tx(list);
    return { data: list as unknown as T[], error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

export async function upsert<T = any>(
  table: string,
  data: Record<string, any> | Record<string, any>[],
): Promise<SqliteResult<T[]>> {
  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) return { data: [] as T[], error: null };
  const pks = PRIMARY_KEYS[table];
  if (!pks) return { data: null, error: `upsert: no primary-key mapping for table ${table}` };
  try {
    const d = getDb();
    const cols = Object.keys(list[0]);
    const setCols = cols.filter((c) => !pks.includes(c));
    const conflict = pks.join(",");
    const updateClause = setCols.map((c) => `${c} = excluded.${c}`).join(",");
    const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")}) ON CONFLICT(${conflict}) DO UPDATE SET ${updateClause}`;
    const stmt = d.prepare(sql);
    const tx = d.transaction((rows: Record<string, any>[]) => {
      for (const r of rows) stmt.run(...cols.map((c) => normalizeValue(table, c, r[c])));
    });
    tx(list);
    return { data: list as unknown as T[], error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

export async function update(
  table: string,
  filters: Filter,
  data: Record<string, any>,
): Promise<SqliteResult<any[]>> {
  try {
    const d = getDb();
    const where = buildWhere(table, filters);
    const cols = Object.keys(data);
    if (cols.length === 0) return { data: [], error: null };
    const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(",")}${where.sql ? ` WHERE ${where.sql}` : ""}`;
    const params = [...cols.map((c) => normalizeValue(table, c, data[c])), ...where.params];
    d.prepare(sql).run(...params);
    return { data: [], error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

export async function del(
  table: string,
  filters: Filter,
): Promise<SqliteResult<any[]>> {
  try {
    const d = getDb();
    const where = buildWhere(table, filters);
    const sql = `DELETE FROM ${table}${where.sql ? ` WHERE ${where.sql}` : ""}`;
    d.prepare(sql).run(...where.params);
    return { data: [], error: null };
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

// ── RPC — the four plpgsql functions from schema/supabase-schema.sql ─────────

export async function rpc<T = any>(
  functionName: string,
  params: Record<string, any> = {},
): Promise<SqliteResult<T>> {
  try {
    switch (functionName) {
      case "append_inbound_email":
        return { data: rpcAppendInboundEmail(params) as unknown as T, error: null };
      case "redeem_beta_code":
        return { data: rpcRedeemBetaCode(params) as unknown as T, error: null };
      case "credit_status":
        return { data: rpcCreditStatus(params) as unknown as T, error: null };
      case "usage_buckets":
        return { data: rpcUsageBuckets(params) as unknown as T, error: null };
      default:
        return { data: null, error: `Unknown RPC function: ${functionName}` };
    }
  } catch (err) {
    return { data: null, error: normalizeError(err) };
  }
}

function rpcAppendInboundEmail(p: Record<string, any>): number {
  const d = getDb();
  const entry = p.p_entry != null ? JSON.stringify(p.p_entry) : "{}";
  const maxEmails = typeof p.p_max_emails === "number" ? p.p_max_emails : 200;
  const ins = d.prepare(
    `INSERT OR IGNORE INTO inbound_emails (email_id, workspace_id, from_email, from_name, to_address, subject, date, thread_id, size_bytes, status, fail_reason, created_at, entry) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const prune = d.prepare(
    `DELETE FROM inbound_emails WHERE workspace_id = ? AND email_id NOT IN (SELECT email_id FROM inbound_emails WHERE workspace_id = ? ORDER BY created_at DESC, email_id DESC LIMIT ?)`,
  );
  const count = d.prepare(`SELECT COUNT(*) AS n FROM inbound_emails WHERE workspace_id = ?`);
  d.transaction(() => {
    ins.run(
      p.p_email_id,
      p.p_workspace_id,
      p.p_from_email ?? null,
      p.p_from_name ?? null,
      p.p_to_address ?? null,
      p.p_subject ?? null,
      p.p_date ?? null,
      p.p_thread_id ?? null,
      p.p_size_bytes ?? null,
      p.p_status ?? "received",
      p.p_fail_reason ?? null,
      p.p_created_at ?? new Date().toISOString(),
      entry,
    );
    prune.run(p.p_workspace_id, p.p_workspace_id, maxEmails);
  })();
  const row = count.get(p.p_workspace_id) as { n: number };
  return row.n;
}

function rpcRedeemBetaCode(p: Record<string, any>): {
  ok: boolean;
  credit_usd?: number;
  error?: string;
} {
  const d = getDb();
  const code = p.p_code as string;
  const userId = p.p_user_id as string;
  const exists = d.prepare(`SELECT 1 AS x FROM beta_codes WHERE code = ?`).get(code);
  if (!exists) return { ok: false, error: "invalid" };

  let result: { ok: boolean; credit_usd?: number; error?: string } = {
    ok: false,
    error: "already_used",
  };
  d.transaction(() => {
    const upd = d
      .prepare(`UPDATE beta_codes SET status = 'used', used_by_user_id = ?, used_at = ? WHERE code = ? AND status = 'unused'`)
      .run(userId, new Date().toISOString(), code);
    if (upd.changes === 0) return;
    const row = d.prepare(`SELECT credit_usd FROM beta_codes WHERE code = ?`).get(code) as
      | { credit_usd: number }
      | undefined;
    const credit = row?.credit_usd ?? 0;
    d.prepare(`UPDATE admin_users SET credit_balance_usd = COALESCE(credit_balance_usd, 0) + ? WHERE user_id = ?`).run(
      credit,
      userId,
    );
    result = { ok: true, credit_usd: credit };
  })();
  return result;
}

function rpcCreditStatus(p: Record<string, any>): { balance: number; used: number } {
  const d = getDb();
  const userId = p.p_user_id as string;
  const balance =
    (d.prepare(`SELECT COALESCE(credit_balance_usd, 0) AS balance FROM admin_users WHERE user_id = ?`).get(userId) as
      | { balance: number }
      | undefined)?.balance ?? 0;
  const used =
    (d.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS used FROM llm_usage WHERE user_id = ? AND success = 1`).get(userId) as
      | { used: number }
      | undefined)?.used ?? 0;
  return { balance, used };
}

function rpcUsageBuckets(p: Record<string, any>): Array<Record<string, unknown>> {
  const d = getDb();
  const userId = p.p_user_id as string;
  // created_at is ISO-8601 UTC; substr(1,10)=day, substr(1,7)=month. Deterministic
  // and avoids SQLite date-function parsing ambiguity around the 'Z' suffix.
  const width = p.p_granularity === "month" ? 7 : 10;
  const where = ["user_id = ?", "success = 1"];
  const params: SQLQueryBindings[] = [userId];
  if (p.p_since != null) {
    where.push("created_at >= ?");
    params.push(p.p_since);
  }
  if (p.p_until != null) {
    where.push("created_at < ?");
    params.push(p.p_until);
  }
  const sql =
    `SELECT substr(created_at, 1, ${width}) AS bucket, model, ` +
    `SUM(cost_usd) AS cost_usd, SUM(COALESCE(input_tokens, 0)) AS input_tokens, ` +
    `SUM(COALESCE(output_tokens, 0)) AS output_tokens, COUNT(*) AS requests ` +
    `FROM llm_usage WHERE ${where.join(" AND ")} GROUP BY bucket, model ORDER BY bucket, model`;
  return d.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}
