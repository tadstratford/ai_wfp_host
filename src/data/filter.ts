/**
 * Deterministic row filtering — a small predicate language over tabular rows.
 *
 * Pure module (no app imports): shared by the data tools (`aggregate_data`,
 * `report_table`) and the chat planner (which asks the LLM to emit a predicate
 * from a workspace rule, then applies it here deterministically). Nothing here
 * is guessed — a predicate that can't match a row simply excludes it.
 */

import { z } from "zod";

export const FILTER_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "in",
  "is_empty",
  "not_empty",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

/** A single predicate: `column` compared against `value` via `op`. */
export interface FilterClause {
  column: string;
  op: FilterOp;
  value?: string | number;
}

export const FilterClauseSchema = z.object({
  column: z.string(),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number()]).optional(),
});

export const FilterSchema = z.array(FilterClauseSchema);

/** Numeric parse that tolerates currency commas and symbols; null when not a
 *  plain number (so ISO date strings fall through to string comparison). */
function toNumeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/[,$%]/g, "");
    if (t === "" || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Evaluate one clause against a single cell value. */
export function matchesClause(value: unknown, clause: FilterClause): boolean {
  const op = clause.op;
  const target = clause.value;
  const s = value === null || value === undefined ? "" : String(value).trim();

  if (op === "is_empty") return s === "";
  if (op === "not_empty") return s !== "";
  if (op === "contains") return s.toLowerCase().includes(String(target ?? "").toLowerCase());
  if (op === "not_contains") return !s.toLowerCase().includes(String(target ?? "").toLowerCase());
  if (op === "in") {
    const list = String(target ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return list.includes(s);
  }
  if (op === "eq") return s === String(target ?? "");
  if (op === "ne") return s !== String(target ?? "");

  // gt / gte / lt / lte — numeric when both sides parse as numbers, otherwise
  // lexicographic (correct for ISO date strings).
  const num = toNumeric(value);
  const tnum = toNumeric(target);
  if (num !== null && tnum !== null) {
    if (op === "gt") return num > tnum;
    if (op === "gte") return num >= tnum;
    if (op === "lt") return num < tnum;
    if (op === "lte") return num <= tnum;
  }
  const ts = String(target ?? "");
  if (op === "gt") return s > ts;
  if (op === "gte") return s >= ts;
  if (op === "lt") return s < ts;
  if (op === "lte") return s <= ts;
  return false;
}

/** True when a row (object map) satisfies every clause. */
export function rowMatchesFilter(
  row: Record<string, unknown>,
  filter: FilterClause[],
): boolean {
  for (const c of filter) {
    if (!matchesClause(row[c.column], c)) return false;
  }
  return true;
}

/** Filter an array of object rows, keeping rows that satisfy every clause. */
export function applyRowFilter(
  rows: Record<string, unknown>[],
  filter?: FilterClause[],
): Record<string, unknown>[] {
  if (!filter || filter.length === 0) return rows;
  return rows.filter((r) => rowMatchesFilter(r, filter));
}

/** True when a cell-array row (parallel to `columns`) satisfies every clause. */
export function cellRowMatches(
  columns: string[],
  cells: string[],
  filter: FilterClause[],
): boolean {
  for (const c of filter) {
    const idx = columns.indexOf(c.column);
    const value = idx >= 0 ? cells[idx] : undefined;
    if (!matchesClause(value, c)) return false;
  }
  return true;
}
