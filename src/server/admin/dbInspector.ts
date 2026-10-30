// dbInspector — read-only SQLite inspection for the admin DB inspector page.
//
// Opens a SEPARATE read-only handle on the datastore file so an operator can
// run arbitrary SELECTs without risk of writes. Restricted to single-statement
// read-only SQL (SELECT / WITH / PRAGMA / EXPLAIN).

import { Database } from "bun:sqlite";
import { dbFilePath, getDb } from "./sqlite";

export interface TableInfo {
  name: string;
  rowCount: number;
}

export function listTables(): TableInfo[] {
  const d = getDb();
  const names = d
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>;
  return names.map(({ name }) => {
    const { n } = d.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    return { name, rowCount: n };
  });
}

export type QueryResult =
  | { ok: true; columns: string[]; rows: unknown[][]; rowCount: number }
  | { ok: false; error: string };

export function runReadonlyQuery(sql: string): QueryResult {
  const trimmed = sql.trim();
  if (!trimmed) return { ok: false, error: "Enter a query." };
  if (!/^(select|with|pragma|explain)\b/i.test(trimmed)) {
    return { ok: false, error: "Only read-only queries (SELECT / WITH / PRAGMA / EXPLAIN) are allowed." };
  }
  const withoutTrailingSemicolon = trimmed.replace(/;+\s*$/, "");
  if (/;/.test(withoutTrailingSemicolon)) {
    return { ok: false, error: "Multiple statements are not allowed." };
  }

  let d: Database;
  try {
    d = new Database(dbFilePath(), { readonly: true });
  } catch (err) {
    return { ok: false, error: `Could not open database read-only: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const stmt = d.prepare(withoutTrailingSemicolon);
    const columns = [...stmt.columnNames];
    const rows = stmt.all() as Array<Record<string, unknown>>;
    const rowLimit = 200;
    const shown = rows.slice(0, rowLimit).map((r) => columns.map((col) => r[col] ?? null));
    return { ok: true, columns, rows: shown, rowCount: rows.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    d.close();
  }
}
