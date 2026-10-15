/**
 * Manage the signup allowlist (who may create an account). Run from the
 * operator's machine:
 *
 *   bun run scripts/manage-allowlist.ts list
 *   bun run scripts/manage-allowlist.ts add    you@example.com [--notes "bookkeeper"]
 *   bun run scripts/manage-allowlist.ts remove you@example.com
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (.env is
 * auto-loaded by Bun). Emails are normalized to lowercase. "remove" revokes
 * the row; "add" upserts it back to status 'allowed'.
 */

const args = process.argv.slice(2);
const cmd = (args[0] || "").toLowerCase();
const email = (args[1] || "").trim().toLowerCase();

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
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

async function list() {
  const res = await fetch(`${url}/rest/v1/signup_allowlist?select=email,status,notes,created_at&order=created_at.desc`, {
    headers: { ...headers, Prefer: "return=representation" },
  });
  if (!res.ok) throw new Error(`list: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as any[];
  if (rows.length === 0) {
    console.log("Allowlist is empty.");
    return;
  }
  console.log(`\n${rows.length} allowed email(s):\n`);
  for (const r of rows) {
    const line = [r.email, r.status, r.notes ? `(${r.notes})` : null].filter(Boolean).join("  ");
    console.log(`  ${line}`);
  }
}

async function add() {
  if (!email || !email.includes("@")) throw new Error("Provide an email: manage-allowlist.ts add you@example.com");
  const notes = flag("--notes") ?? null;
  const res = await fetch(`${url}/rest/v1/signup_allowlist`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ email, status: "allowed", notes }),
  });
  if (!res.ok) throw new Error(`add: ${res.status} ${await res.text()}`);
  console.log(`Added ${email} to the signup allowlist.`);
}

async function remove() {
  if (!email || !email.includes("@")) throw new Error("Provide an email: manage-allowlist.ts remove you@example.com");
  const res = await fetch(`${url}/rest/v1/signup_allowlist?email=eq.${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) throw new Error(`remove: ${res.status} ${await res.text()}`);
  console.log(`Removed ${email} from the signup allowlist.`);
}

async function main() {
  switch (cmd) {
    case "list":
      return list();
    case "add":
      return add();
    case "remove":
      return remove();
    default:
      console.log("Usage:\n  bun run scripts/manage-allowlist.ts <list|add|remove> [email] [--notes \"...\"]");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
