/**
 * Create a regular beta user with a password, credits, and a signup-allowlist
 * entry — all in one run. Use for handing out beta/LLM-test accounts.
 *
 *   bun run scripts/create-user.ts you@example.com --credit 25 --password "secret"
 *   bun run scripts/create-user.ts you@example.com --credit 25   # password read from stdin
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (.env is
 * auto-loaded by Bun). Emails are normalized to lowercase. Creates the
 * admin_users row (fresh user_id + database_id), writes a bcrypt password_hash,
 * grants credit_balance_usd, and upserts a signup_allowlist row (status
 * 'allowed'). Throws if the account already exists.
 */

import { createInterface } from "node:readline";
import { hashPassword } from "../src/shared/crypto/hash";

const args = process.argv.slice(2);
const email = (args[0] || "").trim().toLowerCase();

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readPassword(): Promise<string> {
  const explicit = flag("--password");
  if (explicit) return explicit;

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return new Promise<string>((resolve) => {
    rl.question("New password: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY ?? "";

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function main() {
  if (!email || !email.includes("@")) {
    console.error("Provide an email: bun run scripts/create-user.ts you@example.com");
    process.exit(1);
  }

  const credit = Math.max(0, parseFloat(flag("--credit") ?? "25") || 25);
  const name = flag("--name") ?? email.split("@")[0];
  const notes = flag("--notes") ?? null;

  // 1. Existing-user check — abort cleanly instead of a unique-violation 409.
  const find = await fetch(
    `${url}/rest/v1/admin_users?user_email=eq.${encodeURIComponent(email)}&select=user_id`,
    { headers },
  );
  if (!find.ok) throw new Error(`lookup: ${find.status} ${await find.text()}`);
  const rows = (await find.json()) as { user_id: string }[];
  if (rows.length > 0) {
    console.error(`User ${email} already exists (user_id ${rows[0].user_id}). Nothing to do.`);
    process.exit(1);
  }

  // 2. Password (flag or stdin), then hash.
  const password = await readPassword();
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  const hash = await hashPassword(password);

  // 3. Upsert signup_allowlist (idempotent — merge-duplicates).
  const allow = await fetch(`${url}/rest/v1/signup_allowlist`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email, status: "allowed", notes }),
  });
  if (!allow.ok) throw new Error(`allowlist: ${allow.status} ${await allow.text()}`);

  // 4. Create admin_users row (password_hash + credits in the same insert).
  const userId = crypto.randomUUID();
  const databaseId = crypto.randomUUID();
  const create = await fetch(`${url}/rest/v1/admin_users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      user_id: userId,
      user_name: name,
      user_email: email,
      user_admin_flag: 0,
      database_id: databaseId,
      workspace_name: "My Workspace",
      dark_mode: 1,
      credit_balance_usd: credit,
      password_hash: hash,
    }),
  });
  if (!create.ok) throw new Error(`create user: ${create.status} ${await create.text()}`);

  console.log(`\nCreated user ${email}`);
  console.log(`  user_id:      ${userId}`);
  console.log(`  database_id:  ${databaseId}`);
  console.log(`  credits:      $${credit.toFixed(2)}`);
  console.log(`  allowlist:    allowed`);
  console.log(`  password:     set`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
