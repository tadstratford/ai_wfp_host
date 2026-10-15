/**
 * Reset a user's password for AUTH=password deployments. Run from the
 * operator's machine:
 *
 *   bun run scripts/reset-password.ts you@example.com
 *   bun run scripts/reset-password.ts you@example.com --password "new-secret"
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (.env is
 * auto-loaded by Bun). Without --password, the password is read from stdin so
 * it does not land in shell history (echo is not masked). Emails are normalized
 * to lowercase. Writes admin_users.password_hash directly via PostgREST.
 *
 * NOTE: targets the Supabase/postgres backend directly, matching the existing
 * manage-allowlist.ts operator script. Move to the DataStore seam when that
 * lands (file/sqlite backends).
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
    console.error("Provide an email: bun run scripts/reset-password.ts you@example.com");
    process.exit(1);
  }

  const find = await fetch(
    `${url}/rest/v1/admin_users?user_email=eq.${encodeURIComponent(email)}&select=user_id`,
    { headers },
  );
  if (!find.ok) throw new Error(`lookup: ${find.status} ${await find.text()}`);
  const rows = (await find.json()) as { user_id: string }[];
  if (rows.length === 0) {
    console.error(`No user found for ${email}. Create the account first (ADMIN_USER on startup).`);
    process.exit(1);
  }
  const userId = rows[0].user_id;

  const password = await readPassword();
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const hash = await hashPassword(password);

  const patch = await fetch(
    `${url}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ password_hash: hash }),
    },
  );
  if (!patch.ok) throw new Error(`update: ${patch.status} ${await patch.text()}`);
  console.log(`Password updated for ${email}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
