// Deterministic data profiling — the engine behind the `profile_data` tool.
//
// Pure functions (no app imports, no LLM). Computes per-column completeness,
// distinct counts, type violations, exact-duplicate rows, and — when the caller
// names the columns — footings ("Total Expenses = Fund I Expenses + Fund II
// Expenses"). Footings are explicit: the caller decides which columns should
// sum, the code only does the arithmetic (no column guessing).

import { parseNumber } from "./stage";
import type { DiscoveryTable } from "./catalog/discover";
import type { TableProfile, ColumnProfile, FootingCheck, FootingSpec } from "wfp-format";

/** Cent-level tolerance for footing identities. */
const FOOTING_TOLERANCE = 0.01;
/** Minimum comparable rows for a footing to be reported. */
const MIN_FOOTING_ROWS = 2;
/**
 * Fraction of comparable rows that must hold for a footing to be reported.
 * Deliberately below 1.0 so a *broken* footing ("should sum, but N rows don't")
 * is surfaced — that is the data-health signal. A clean footing reports
 * `holds: true`; a mostly-holding one reports `holds: false` with `mismatchRows`.
 */
const FOOTING_CONSISTENCY = 0.75;
/** Minimum summands in a footing (single-column equality is not a cross-foot). */
const MIN_SUMMANDS = 2;
/** Maximum summands considered (bounds the subset enumeration). */
const MAX_SUMMANDS = 3;
/** Cap on amount columns; beyond this we skip footing detection (O(n^k) blowup). */
const MAX_FOOTING_COLUMNS = 12;

/**
 * A "whole" column (a total/sum/gross/net) can be a footing *target* but never a
 * *summand* — otherwise an inverted, tautological footing like
 * "Fund I = Total + Fund II" (which holds whenever Fund II is zero) is reported.
 */
const WHOLE_COLUMN = /total|sum|gross|net/i;

/**
 * Parse a cell as an amount, with accounting placeholders treated as zero.
 * `"$-"`, `"-"`, `"–"`, `"—"`, `"( )"` mean "no amount" → 0; blank/null means
 * "missing" → null (skip the row); anything parseable via parseNumber is a number.
 */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const stripped = s.replace(/[$,\s()]/g, "");
  if (stripped === "" || /^[-–—]$/.test(stripped)) return 0;
  return parseNumber(s);
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  return String(v).trim() === "";
}

function typeViolation(v: unknown, type: string | undefined): boolean {
  if (type == null || isBlank(v)) return false;
  if (type === "number") {
    if (typeof v === "number") return !Number.isFinite(v);
    return parseNumber(String(v)) === null;
  }
  if (type === "boolean") {
    const b = String(v).trim().toLowerCase();
    return b !== "true" && b !== "false";
  }
  return false;
}

/** A column is "amount-capable" when ≥90% of its non-blank cells parse as amounts. */
function isAmountCapable(rows: Record<string, unknown>[], column: string): boolean {
  let nonBlank = 0;
  let parseable = 0;
  for (const r of rows) {
    if (isBlank(r[column])) continue;
    nonBlank++;
    if (parseAmount(r[column]) !== null) parseable++;
  }
  if (nonBlank === 0) return false;
  return parseable / nonBlank >= 0.9;
}

function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  const withHead = combinations(rest, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

interface FootingEval {
  holds: boolean;
  mismatchRows: number;
  maxAbsDiff: number;
  checked: number;
}

function evalFooting(
  rows: Record<string, unknown>[],
  target: string,
  summands: string[],
): FootingEval {
  let checked = 0;
  let holding = 0;
  let maxDiff = 0;
  for (const r of rows) {
    const left = parseAmount(r[target]);
    if (left === null) continue;
    let sum = 0;
    let skip = false;
    for (const c of summands) {
      const v = parseAmount(r[c]);
      if (v === null) {
        skip = true;
        break;
      }
      sum += v;
    }
    if (skip) continue;
    checked++;
    const diff = Math.abs(left - sum);
    if (diff > maxDiff) maxDiff = diff;
    if (diff <= FOOTING_TOLERANCE) holding++;
  }
  const mismatchRows = checked - holding;
  const holds = checked >= MIN_FOOTING_ROWS && holding / checked >= FOOTING_CONSISTENCY;
  return { holds, mismatchRows, maxAbsDiff: maxDiff, checked };
}

/** Check one explicit footing identity: does `leftColumn` equal the sum of
 *  `rightColumns` for every comparable row? Reports holds / mismatchRows. */
export function checkFooting(
  rows: Record<string, unknown>[],
  leftColumn: string,
  rightColumns: string[],
): FootingCheck {
  const e = evalFooting(rows, leftColumn, rightColumns);
  return {
    label: `${leftColumn} = ${rightColumns.join(" + ")}`,
    leftColumn,
    rightColumns,
    holds: e.checked > 0 && e.mismatchRows === 0,
    mismatchRows: e.mismatchRows,
    maxAbsDiff: e.maxAbsDiff,
  };
}

/** Detect cross-foot identities among amount-capable columns (smallest-size wins). */
export function detectFootings(table: {
  columns: string[];
  rows: Record<string, unknown>[];
}): FootingCheck[] {
  const { columns, rows } = table;
  const amountCols = columns.filter((c) => isAmountCapable(rows, c));
  if (amountCols.length < MIN_SUMMANDS + 1) return [];
  if (amountCols.length > MAX_FOOTING_COLUMNS) return [];

  const footings: FootingCheck[] = [];
  for (const target of amountCols) {
    const others = amountCols.filter((c) => c !== target && !WHOLE_COLUMN.test(c));
    for (let size = MIN_SUMMANDS; size <= Math.min(MAX_SUMMANDS, others.length); size++) {
      let best: FootingEval | null = null;
      let bestSummands: string[] = [];
      for (const combo of combinations(others, size)) {
        const evalRes = evalFooting(rows, target, combo);
        if (!evalRes.holds) continue;
        // Prefer the subset with the fewest mismatches, then largest |diff| (most informative).
        if (best === null || evalRes.mismatchRows < best.mismatchRows) {
          best = evalRes;
          bestSummands = combo;
        }
      }
      if (best) {
        footings.push({
          label: `${target} = ${bestSummands.join(" + ")}`,
          leftColumn: target,
          rightColumns: bestSummands,
          holds: best.mismatchRows === 0,
          mismatchRows: best.mismatchRows,
          maxAbsDiff: best.maxAbsDiff,
        });
        break; // smallest-size footing wins for this target
      }
    }
  }
  return footings;
}

/** Profile a single table. Footings are computed only from the explicit specs in
 *  `opts.footings` — nothing is auto-detected, so the result is never a guess. */
export function profileTable(table: DiscoveryTable, opts?: { footings?: FootingSpec[] }): TableProfile {
  const { name, columns, rows, columnTypes } = table;

  const colProfiles: ColumnProfile[] = columns.map((column) => {
    let nonNull = 0;
    let nullCount = 0;
    let violations = 0;
    const distinct = new Set<string>();
    for (const r of rows) {
      const v = r[column];
      if (isBlank(v)) {
        nullCount++;
      } else {
        nonNull++;
        distinct.add(String(v));
      }
      if (typeViolation(v, columnTypes?.[column])) violations++;
    }
    return {
      column,
      type: columnTypes?.[column] ?? "unknown",
      nonNull,
      nullCount,
      distinct: distinct.size,
      typeViolations: violations,
    };
  });

  // Exact-duplicate rows (canonical, key-order-independent serialization).
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const r of rows) {
    const key = Object.entries(r)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}\u0000${String(v ?? "")}`)
      .join("\u0001");
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }

  const footings = (opts?.footings ?? []).map((f) =>
    checkFooting(rows, f.leftColumn, f.rightColumns),
  );

  return {
    name,
    rowCount: rows.length,
    columnCount: columns.length,
    columns: colProfiles,
    duplicateRows,
    footings,
  };
}
