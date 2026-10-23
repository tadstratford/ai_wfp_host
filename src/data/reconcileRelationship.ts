// Deterministic relationship reconciliation — pure, no LLM.
//
// Reconciles two tables on a discovered relationship (equals/contains), where
// the right-side key is embedded in a text column (e.g. ICO "Description"
// containing "Write off - Ironwave: …" against a schedule keyed on "Deal Name").
// Produces per-key variances and orphan lists — the deterministic core behind
// the `reconcile_relationship` tool.

import { candidatePhrases } from "./catalog/discover";

export interface ReconcileRelationshipInput {
  leftRows: Record<string, unknown>[];
  rightRows: Record<string, unknown>[];
  leftKey: string;
  rightKey: string;
  kind: "equals" | "contains";
  leftAmount: string;
  rightAmount: string;
  tolerance?: number;
  /** Lowercased alias → raw canonical left-key value (from the catalog). */
  aliases?: Record<string, string>;
}

export interface ReconcileRelationshipResult {
  kind: "equals" | "contains";
  tolerance: number;
  summary: { matched: number; mismatched: number; missing_left: number; missing_right: number };
  mismatches: { key: string; left: number; right: number; difference: number }[];
  missing_right: string[];
  missing_left: string[];
}

const MAX_LIST = 200;

function cell(v: unknown): string {
  return String(v ?? "").trim();
}

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

export function reconcileRelationship(input: ReconcileRelationshipInput): ReconcileRelationshipResult {
  const tolerance = input.tolerance ?? 0;

  // Left side: distinct keys + summed amounts.
  const leftAmounts = new Map<string, number>();
  const leftOrder: string[] = [];
  for (const r of input.leftRows) {
    const k = cell(r[input.leftKey]);
    if (k === "") continue;
    const amt = toNumber(r[input.leftAmount]) ?? 0;
    if (!leftAmounts.has(k)) leftOrder.push(k);
    leftAmounts.set(k, (leftAmounts.get(k) ?? 0) + amt);
  }

  // phrase (lowercased) → raw left key (longest phrase wins on collision).
  const phraseToKey = new Map<string, string>();
  for (const k of leftOrder) {
    for (const p of candidatePhrases(k)) {
      const existing = phraseToKey.get(p);
      if (!existing || k.length > existing.length) phraseToKey.set(p, k);
    }
  }

  // alias (lowercased) → raw canonical left key.
  const aliasToKey = new Map<string, string>();
  for (const [alias, canonical] of Object.entries(input.aliases ?? {})) {
    const a = alias.toLowerCase();
    const target = leftAmounts.has(canonical) ? canonical : (phraseToKey.get(canonical.toLowerCase()) ?? canonical);
    aliasToKey.set(a, target);
  }

  const matches = (text: string): string | null => {
    const lower = text.toLowerCase();
    for (const [alias, canonical] of aliasToKey) {
      if (input.kind === "equals" ? lower === alias : lower.includes(alias)) return canonical;
    }
    let best: string | null = null;
    let bestLen = 0;
    for (const [phrase, key] of phraseToKey) {
      const hit = input.kind === "equals" ? lower === phrase : lower.includes(phrase);
      if (hit && phrase.length > bestLen) {
        best = key;
        bestLen = phrase.length;
      }
    }
    return best;
  };

  // Right side: assign each row to a left key, sum amounts.
  const rightByKey = new Map<string, number>();
  const missingLeftRows = new Set<string>();
  for (const r of input.rightRows) {
    const text = cell(r[input.rightKey]);
    if (text === "") continue;
    const k = matches(text);
    if (k === null) {
      missingLeftRows.add(text);
      continue;
    }
    const amt = toNumber(r[input.rightAmount]) ?? 0;
    rightByKey.set(k, (rightByKey.get(k) ?? 0) + amt);
  }

  // Reconcile per left key.
  const mismatches: ReconcileRelationshipResult["mismatches"] = [];
  const missingRight: string[] = [];
  let matched = 0;
  for (const k of leftOrder) {
    const leftAmt = leftAmounts.get(k) ?? 0;
    const rightAmt = rightByKey.get(k);
    if (rightAmt === undefined) {
      missingRight.push(k);
      continue;
    }
    const difference = rightAmt - leftAmt;
    if (Math.abs(difference) > tolerance) {
      mismatches.push({ key: k, left: leftAmt, right: rightAmt, difference });
    } else {
      matched++;
    }
  }

  return {
    kind: input.kind,
    tolerance,
    summary: {
      matched,
      mismatched: mismatches.length,
      missing_left: missingLeftRows.size,
      missing_right: missingRight.length,
    },
    mismatches,
    missing_right: missingRight.slice(0, MAX_LIST),
    missing_left: Array.from(missingLeftRows).slice(0, MAX_LIST),
  };
}
