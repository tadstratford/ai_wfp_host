// userAdmin — admin-only user management for the /admin/users form.
//
// Replaces the Supabase-only operator scripts (scripts/create-user.ts and
// scripts/reset-password.ts) with backend-agnostic operations that route
// through the datastore seam (supabase.ts → sqlite.ts when DB_BACKEND=sqlite),
// so they work against the on-server SQLite database.
//
// Only password_hash and credit_balance_usd are touched beyond the normal
// user columns; password hashes are bcrypt (Bun.password) and never surfaced
// back out — listUsers only reports whether a hash is present.

import { select, selectOne, insert, upsert, update } from "./supabase";
import { hashPassword } from "@backend/core/crypto/hash";

export interface UserRow {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
  creditBalanceUsd: number;
  hasPassword: boolean;
  createdAt: string | null;
}

export type AdminResult = { ok: true } | { ok: false; error: string };

const USER_ADMIN_COLUMNS =
  "user_id,user_email,user_name,user_admin_flag,credit_balance_usd,password_hash,created_at";

function normalizeEmail(email: string): string {
  return (email || "").trim().toLowerCase();
}

/** List every admin_users row with just the columns the admin form needs. */
export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await select("admin_users", {}, USER_ADMIN_COLUMNS);
  if (error) throw new Error(error);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({
      userId: String(r.user_id ?? ""),
      email: String(r.user_email ?? ""),
      name: String(r.user_name ?? ""),
      isAdmin: Number(r.user_admin_flag) === 1,
      creditBalanceUsd: typeof r.credit_balance_usd === "number" ? r.credit_balance_usd : 0,
      hasPassword: typeof r.password_hash === "string" && r.password_hash.length > 0,
      createdAt: typeof r.created_at === "string" ? r.created_at : null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export interface CreateUserArgs {
  email: string;
  name?: string;
  password: string;
  credit?: number;
  isAdmin?: boolean;
}

/** Create a user with a bcrypt password, an allowlist entry, and credits. */
export async function createUser(args: CreateUserArgs): Promise<AdminResult> {
  const email = normalizeEmail(args.email);
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };

  const password = args.password ?? "";
  if (!password || password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const name = (args.name || "").trim() || email.split("@")[0];
  const credit = Math.max(0, typeof args.credit === "number" ? args.credit : 0);

  const existing = await selectOne("admin_users", { user_email: email }, "user_id");
  if (existing.error) return { ok: false, error: existing.error };
  if (existing.data) return { ok: false, error: `User ${email} already exists.` };

  const hash = await hashPassword(password);

  const allow = await upsert("signup_allowlist", {
    email,
    status: "allowed",
    notes: null,
  });
  if (allow.error) return { ok: false, error: `allowlist: ${allow.error}` };

  const created = await insert("admin_users", {
    user_id: crypto.randomUUID(),
    database_id: crypto.randomUUID(),
    user_name: name,
    user_email: email,
    user_admin_flag: args.isAdmin ? 1 : 0,
    workspace_name: "My Workspace",
    dark_mode: 1,
    credit_balance_usd: credit,
    password_hash: hash,
  });
  if (created.error) return { ok: false, error: created.error };

  return { ok: true };
}

export interface ResetPasswordArgs {
  email: string;
  password: string;
}

/** Reset a user's password by email (bcrypt hash written directly). */
export async function resetPassword(args: ResetPasswordArgs): Promise<AdminResult> {
  const email = normalizeEmail(args.email);
  if (!email || !email.includes("@")) return { ok: false, error: "Enter a valid email." };

  const password = args.password ?? "";
  if (!password || password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const found = await selectOne<{ user_id: string }>("admin_users", { user_email: email }, "user_id");
  if (found.error) return { ok: false, error: found.error };
  if (!found.data?.user_id) return { ok: false, error: `No user found for ${email}.` };

  const hash = await hashPassword(password);
  const patched = await update("admin_users", { user_id: found.data.user_id }, { password_hash: hash });
  if (patched.error) return { ok: false, error: patched.error };

  return { ok: true };
}
