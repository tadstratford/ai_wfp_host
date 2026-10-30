import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqlite from "./sqlite";

// Point the datastore at a throwaway temp dir before first open.
const dir = mkdtempSync(join(tmpdir(), "wfp-sqlite-"));
process.env.DATA_DIR = dir;
process.env.INSTANCE = "test";

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeAll(() => {
  sqlite.getDb();
});

describe("sqlite adapter", () => {
  test("schema applies and admin_users CRUD works", async () => {
    const uid = "user-1";
    await sqlite.insert("admin_users", {
      user_id: uid,
      auth_user_id: "google_1",
      user_name: "Alice",
      user_email: "alice@example.com",
      user_admin_flag: 1,
      database_id: "db-1",
    });

    const one = await sqlite.selectOne<{ user_email: string }>(
      "admin_users",
      { user_id: uid },
      "user_email",
    );
    expect(one.error).toBeNull();
    expect(one.data?.user_email).toBe("alice@example.com");

    await sqlite.update("admin_users", { user_id: uid }, { workspace_name: "Renamed" });
    const renamed = await sqlite.selectOne<{ workspace_name: string }>(
      "admin_users",
      { user_id: uid },
      "workspace_name",
    );
    expect(renamed.data?.workspace_name).toBe("Renamed");

    await sqlite.del("admin_users", { user_id: uid });
    const gone = await sqlite.selectOne("admin_users", { user_id: uid });
    expect(gone.data).toBeNull();
  });

  test("redeem_beta_code + credit_status + usage_buckets", async () => {
    await sqlite.insert("admin_users", {
      user_id: "u",
      user_name: "Bob",
      user_email: "bob@example.com",
    });
    await sqlite.insert("beta_codes", { code: "ABC", credit_usd: 15, status: "unused" });

    const redeem = await sqlite.rpc("redeem_beta_code", { p_code: "ABC", p_user_id: "u" });
    expect(redeem.error).toBeNull();
    expect(redeem.data).toEqual({ ok: true, credit_usd: 15 });

    const again = await sqlite.rpc("redeem_beta_code", { p_code: "ABC", p_user_id: "u" });
    expect(again.data).toEqual({ ok: false, error: "already_used" });

    const status = await sqlite.rpc("credit_status", { p_user_id: "u" });
    expect(status.data).toEqual({ balance: 15, used: 0 });

    await sqlite.insert("llm_usage", {
      id: "usage-1",
      user_id: "u",
      model: "m",
      source: "chat",
      cost_usd: 2,
      success: 1,
      input_tokens: 100,
      output_tokens: 50,
      created_at: "2026-01-15T12:00:00.000Z",
    });

    const status2 = await sqlite.rpc("credit_status", { p_user_id: "u" });
    expect(status2.data).toEqual({ balance: 15, used: 2 });

    const buckets = await sqlite.rpc("usage_buckets", {
      p_user_id: "u",
      p_granularity: "day",
    });
    expect(Array.isArray(buckets.data)).toBe(true);
    const rows = buckets.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].bucket).toBe("2026-01-15");
    expect(rows[0].cost_usd).toBe(2);
    expect(rows[0].requests).toBe(1);
  });

  test("workspaces + workspace_content upsert + JSON/BOOL hydration", async () => {
    await sqlite.insert("workspaces", {
      workspace_id: "ws-1",
      user_id: "u",
      name: "W",
      enc_metadata: "{}",
      enc_workflows: "[]",
    });

    await sqlite.upsert("workspace_content", {
      workspace_id: "ws-1",
      content_hash: "h1",
      enc_content: "v1",
    });
    await sqlite.upsert("workspace_content", {
      workspace_id: "ws-1",
      content_hash: "h1",
      enc_content: "v2",
    });
    const content = await sqlite.selectOne<{ enc_content: string }>(
      "workspace_content",
      { workspace_id: "ws-1", content_hash: "h1" },
      "enc_content",
    );
    expect(content.data?.enc_content).toBe("v2");

    // JSONB column hydration (inbound_email_addresses.allowlisted_senders).
    await sqlite.insert("inbound_email_addresses", {
      address_key: "key-1",
      workspace_id: "ws-1",
      user_id: "u",
      secret_encrypted: "x",
      allowlisted_senders: ["a@b.com"],
      outbound_allowlist: [],
      enabled: true,
    });
    const addr = await sqlite.selectOne<any>(
      "inbound_email_addresses",
      { address_key: "key-1" },
      "allowlisted_senders,outbound_allowlist,enabled",
    );
    expect(addr.data?.allowlisted_senders).toEqual(["a@b.com"]);
    expect(addr.data?.outbound_allowlist).toEqual([]);
    expect(addr.data?.enabled).toBe(true);

    // NULL filter → IS NULL semantics.
    await sqlite.update(
      "inbound_email_addresses",
      { address_key: "key-1", allowlisted_senders: null },
      { enabled: false },
    );
    const nullMatch = await sqlite.select("inbound_email_addresses", { allowlisted_senders: null });
    expect((nullMatch.data ?? []).length).toBe(0); // key-1 has a list, so no NULL match
  });

  test("append_inbound_email inserts, prunes, and returns remaining count", async () => {
    const res = await sqlite.rpc("append_inbound_email", {
      p_email_id: "e-1",
      p_workspace_id: "ws-1",
      p_from_email: "x@y.com",
      p_subject: "hi",
      p_status: "received",
      p_created_at: "2026-01-15T12:00:00.000Z",
      p_entry: { textBody: "hello" },
      p_max_emails: 200,
    });
    expect(res.error).toBeNull();
    expect(res.data).toBe(1);

    const email = await sqlite.selectOne<any>(
      "inbound_emails",
      { email_id: "e-1" },
      "email_id,entry",
    );
    expect(email.data?.entry).toEqual({ textBody: "hello" });
  });

  test("foreign-key violation surfaces the 23503 code", async () => {
    const res = await sqlite.insert("inbound_emails", {
      email_id: "e-orphan",
      workspace_id: "no-such-workspace",
      status: "received",
      entry: {},
    });
    expect(res.error).not.toBeNull();
    expect(res.error).toContain("23503");
  });
});
