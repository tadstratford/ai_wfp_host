/**
 * Generate single-use beta codes and insert them into the Supabase `beta_codes`
 * table. Run from the operator's machine:
 *
 *   bun run scripts/generate-beta-codes.ts --count 10 --credit 15 [--notes "founders"]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment (.env is
 * auto-loaded by Bun). Prints the codes to stdout so you can hand them out.
 */

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const count = Math.max(1, parseInt(flag("--count") ?? "10", 10) || 10);
const credit = Math.max(0, parseFloat(flag("--credit") ?? "15") || 15);
const notes = flag("--notes") ?? "";

const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_KEY ?? "";

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
function randomChar(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return ALPHABET[buf[0] % ALPHABET.length];
}
function block(n: number): string {
  return Array.from({ length: n }, randomChar).join("");
}
function genCode(): string {
  return `BETA-${block(4)}-${block(4)}`;
}

async function insert(code: string): Promise<void> {
  const res = await fetch(`${url}/rest/v1/beta_codes`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      code,
      credit_usd: credit,
      status: "unused",
      notes: notes || null,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`INSERT beta_codes: ${res.status} ${body}`);
  }
}

console.log(`Generating ${count} beta code(s) at $${credit.toFixed(2)} each…\n`);

for (let i = 0; i < count; i++) {
  const code = genCode();
  await insert(code);
  console.log(`  ${code}`);
}

console.log(`\nDone. Inserted ${count} code(s).`);
