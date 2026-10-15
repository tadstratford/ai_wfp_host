// Shape registry — the built-in ShapeSpecs.
//
// Each spec captures one reusable report layout. New formats are added here
// (not in the apply/classify engine) so the interpretation logic stays a small,
// deterministic core.

import type { ShapeSpec } from "./types";

/** First non-empty cell in a row. */
function firstCell(row: string[]): string {
  return ((row ?? []).find((c) => (c ?? "").trim() !== "") ?? "").trim();
}

function hasContent(row: string[]): boolean {
  return (row ?? []).some((c) => (c ?? "").trim() !== "");
}

// ── Statement detail (investor I-statement) ────────────────────────────────
// Account section rows look like "1602 - IBVK147 … (Balance forward As of …)";
// transaction rows follow and belong to the account above. The account's entity
// identifier ("IBVK147 … Series") is extracted from the account line and checked
// against each transaction's memo/description so mismatches can be flagged.

const ACCOUNT_RE = /^\d{4}\s*-\s/;
const BALANCE_FORWARD_RE = /balance\s+forward/i;
const TOTALS_RE = /^(total|subtotal|grand total|net total|totals)(\b|$)/i;

function isAccountRow(row: string[]): boolean {
  const c = firstCell(row);
  return ACCOUNT_RE.test(c) || BALANCE_FORWARD_RE.test(c);
}

function isTotalsRow(row: string[]): boolean {
  return TOTALS_RE.test(firstCell(row));
}

/** Normalize an account line to its entity identifier ("IBVK147 … Series"). */
export function extractEntityKey(text: string): string | null {
  let t = (text ?? "").trim();
  t = t.replace(/^\d+\s*-\s*/, "");
  t = t.replace(/\s*\(Balance\s+forward[^)]*\)\s*$/i, "");
  t = t.trim();
  return t.length >= 3 ? t : null;
}

/** Best-effort memo/description cell for a transaction row: the cell containing
 *  the entity key, else the longest non-date/non-numeric cell. */
export function findMemo(row: string[], entity: string): string {
  if (entity) {
    const hit = (row ?? []).find((c) => (c ?? "").trim().includes(entity));
    if (hit) return hit.trim();
  }
  let best = "";
  for (const c of row ?? []) {
    const t = (c ?? "").trim();
    if (!t) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) continue;
    if (/^-?\d[\d,.]*$/.test(t)) continue;
    if (t.length > best.length) best = t;
  }
  return best;
}

export const statementDetailSpec: ShapeSpec = {
  id: "statement_detail",
  label: "Statement detail (account + transaction lines)",
  continuation: "row-below",
  fingerprint: (grid) =>
    grid.some(isAccountRow) && grid.some((r) => !isAccountRow(r) && !isTotalsRow(r) && hasContent(r)),
  isKeyRow: isAccountRow,
  isDataRow: (row) => !isAccountRow(row) && !isTotalsRow(row) && hasContent(row),
  entityKey: extractEntityKey,
  outputColumns: ["account", "entity_key", "memo", "matches"],
  mapRow: (key, row) => {
    const entity = key.entityKey ?? "";
    const memo = findMemo(row, entity);
    const matches = entity !== "" && memo.includes(entity) ? "true" : "false";
    return [key.keyText, entity, memo, matches];
  },
};

/** All registered specs (the deterministic classification surface). */
export function registerShapes(): ShapeSpec[] {
  return [statementDetailSpec];
}
