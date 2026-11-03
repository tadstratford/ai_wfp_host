import { Hono } from "hono";
import { EDITION, AUTH_MODE, dbBackend } from "@shared/edition";
import type { User } from "@backend/types";
import { listTables, runReadonlyQuery } from "@backend/core/admin/dbInspector";
import { listUsers, createUser, resetPassword } from "@backend/core/admin/userAdmin";
import { dbFilePath } from "@backend/core/admin/sqlite";
import { DbInspectorPage, DbResultFragment } from "./dbInspectorPage";
import { UsersAdminPage, UsersResultFragment } from "./usersAdminPage";

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

/**
 * The Users form is operational (not raw-SQL audit), so it needs only a signed
 * in admin on a non-local edition — no DB_AUDIT_ENABLED required. The DB
 * inspector keeps its stricter opt-in gate.
 */
function adminOnly(c: { get(key: string): unknown }): boolean {
  if (EDITION === "local") return false;
  const user = c.get("user") as User | undefined;
  return !!user?.isAuthenticated && !!user?.isAdmin;
}

adminRouter.use("*", async (c, next) => {
  const isUsers = c.req.path.startsWith("/admin/users");
  if (!(isUsers ? adminOnly(c) : allowed(c))) return c.notFound();
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

adminRouter.get("/users", async (c) => {
  const users = await listUsers();
  return c.html(<UsersAdminPage users={users} authMode={AUTH_MODE} />);
});

adminRouter.post("/users/create", async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string) ?? "";
  const name = (body.name as string) ?? "";
  const password = (body.password as string) ?? "";
  const creditRaw = (body.credit as string) ?? "0";
  const credit = Number.parseFloat(creditRaw);
  const isAdmin = body.admin === "on" || body.admin === "1" || body.admin === "true";
  const result = await createUser({
    email,
    name,
    password,
    credit: Number.isFinite(credit) ? credit : 0,
    isAdmin,
  });
  const users = await listUsers();
  return c.html(<UsersResultFragment users={users} result={result} authMode={AUTH_MODE} />);
});

adminRouter.post("/users/reset-password", async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string) ?? "";
  const password = (body.password as string) ?? "";
  const result = await resetPassword({ email, password });
  const users = await listUsers();
  return c.html(<UsersResultFragment users={users} result={result} authMode={AUTH_MODE} />);
});
