import { Hono } from "hono";
import { EDITION, dbBackend } from "@shared/edition";
import type { User } from "@backend/types";
import { listTables, runReadonlyQuery } from "@backend/core/admin/dbInspector";
import { dbFilePath } from "@backend/core/admin/sqlite";
import { DbInspectorPage, DbResultFragment } from "./dbInspectorPage";

export const adminRouter = new Hono();

/**
 * The DB inspector is opt-in and sqlite-only:
 *   - DB_AUDIT_ENABLED=1 must be set (off by default — never expose on hosted).
 *   - DB_BACKEND must be sqlite (Postgres is audited via the Supabase console).
 *   - EDITION=local has no shared datastore.
 *   - The caller must be signed in and flagged admin.
 */
function allowed(c: { get(key: string): unknown }): boolean {
  if (process.env.DB_AUDIT_ENABLED !== "1") return false;
  if (dbBackend() !== "sqlite") return false;
  if (EDITION === "local") return false;
  const user = c.get("user") as User | undefined;
  return !!user?.isAuthenticated && !!user?.isAdmin;
}

adminRouter.use("*", async (c, next) => {
  if (!allowed(c)) return c.notFound();
  await next();
});

adminRouter.get("/db", (c) => {
  const tables = listTables();
  return c.html(<DbInspectorPage tables={tables} path={dbFilePath()} />);
});

adminRouter.post("/db/query", async (c) => {
  const body = await c.req.parseBody();
  const sql = (body.sql as string) ?? "";
  const result = runReadonlyQuery(sql);
  return c.html(<DbResultFragment result={result} />);
});
