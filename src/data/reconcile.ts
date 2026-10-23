/**
 * Deterministic table reconciliation — pure functions, no app imports.
 *
 * Given two arrays of row objects, join them on shared key columns and compare
 * a set of shared columns, reporting which rows match, which mismatch (with a
 * numeric difference where possible), and which rows appear on only one side.
 * Used by the `compare_data` MCP tool to check cross-file fidelity.
 */

export interface ReconcileMismatch {
  /** The join-key values of the mismatching row. */
  key: Record<string, unknown>;
  /** Per-compared-column left/right values and the numeric difference. */
  values: { column: string; left: unknown; right: unknown; difference: number | null }[];
}

export interface ReconcileResult {
  on: string[];
  compare: string[];
  tolerance: number;
  summary: {
    matched: number;
    mismatched: number;
    missing_left: number;
    missing_right: number;
  };
  mismatches: ReconcileMismatch[];
  missing_left: Record<string, unknown>[];
  missing_right: Record<string, unknown>[];
}

function keyOf(row: Record<string, unknown>, cols: string[]): string {
  return JSON.stringify(cols.map((c) => String(row[c] ?? "")));
}

/** Parse a value as a number, tolerating currency commas/symbols; null when not
 *  numeric (so string/date values fall through to string comparison). */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/[,$%]/g, "");
    if (t === "" || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Compare two tables on `on`, diffing `compare` columns within `tolerance`. */
export function reconcileTables(
  leftRows: Record<string, unknown>[],
  rightRows: Record<string, unknown>[],
  on: string[],
  compare: string[],
  tolerance = 0,
): ReconcileResult {
  const rightByKey = new Map<string, { row: Record<string, unknown>; idx: number }[]>();
  rightRows.forEach((row, idx) => {
    const k = keyOf(row, on);
    const list = rightByKey.get(k) ?? [];
    list.push({ row, idx });
    rightByKey.set(k, list);
  });

  const consumed = new Set<string>();
  let matched = 0;
  const mismatches: ReconcileMismatch[] = [];
  const missingRight: Record<string, unknown>[] = [];

  for (const l of leftRows) {
    const k = keyOf(l, on);
    const list = rightByKey.get(k);
    if (!list || list.length === 0) {
      missingRight.push(l);
      continue;
    }
    let pickedIdx = -1;
    for (const entry of list) {
      const ck = `${k}::${entry.idx}`;
      if (!consumed.has(ck)) {
        pickedIdx = entry.idx;
        consumed.add(ck);
        break;
      }
    }
    if (pickedIdx === -1) {
      missingRight.push(l);
      continue;
    }
    const r = rightRows[pickedIdx];
    const values: ReconcileMismatch["values"] = [];
    let ok = true;
    for (const c of compare) {
      const lv = l[c];
      const rv = r[c];
      const ln = toNumber(lv);
      const rn = toNumber(rv);
      let difference: number | null = null;
      if (ln !== null && rn !== null) {
        difference = rn - ln;
        if (Math.abs(difference) > tolerance) ok = false;
      } else if (String(lv ?? "") !== String(rv ?? "")) {
        ok = false;
      }
      values.push({ column: c, left: lv, right: rv, difference });
    }
    if (ok) {
      matched++;
    } else {
      const key = on.reduce<Record<string, unknown>>((acc, c) => {
        acc[c] = l[c];
        return acc;
      }, {});
      mismatches.push({ key, values });
    }
  }

  const missingLeft: Record<string, unknown>[] = [];
  for (const [k, list] of rightByKey.entries()) {
    for (const entry of list) {
      if (!consumed.has(`${k}::${entry.idx}`)) missingLeft.push(entry.row);
    }
  }

  return {
    on,
    compare,
    tolerance,
    summary: {
      matched,
      mismatched: mismatches.length,
      missing_left: missingLeft.length,
      missing_right: missingRight.length,
    },
    mismatches,
    missing_left: missingLeft,
    missing_right: missingRight,
  };
}
