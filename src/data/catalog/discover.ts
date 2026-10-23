// Deterministic relationship discovery — pure, no LLM.
//
// Finds cross-table links ("table A's key column values appear in table B's
// text column") by value containment. This is the load-time seed for the data
// catalog; a Jev pass refines ambiguous/semantic cases (aliases) afterward.

import type { CatalogRelationship } from "wfp-format";

export interface DiscoveryTable {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  source_filename?: string | null;
}

const MIN_MATCHES = 3;
const EQUALS_COVERAGE_THRESHOLD = 0.5;
// Embedded-key containment is inherently partial: a schedule keyed on 30 deal
// names only has its "Dead" deals written off in the ledger, so the Active ones
// never appear. Requiring 0.5 coverage there silently drops a real link.
const CONTAINS_COVERAGE_THRESHOLD = 0.25;
const MIN_PHRASE_LENGTH = 3;
const MAX_EVIDENCE = 3;

/** Normalize a key value into candidate match phrases (lowercased). Strips
 *  parenthetical annotations and "see also" tails, and splits "/" alternatives
 *  so "Torrent Photonics / Resistance Optics" matches either name. */
export function candidatePhrases(value: string): string[] {
  const v = (value ?? "").trim();
  if (!v) return [];
  let base = v;
  const seeAlsoIdx = base.toLowerCase().indexOf("see also");
  if (seeAlsoIdx > 0) base = base.slice(0, seeAlsoIdx);
  const parenIdx = base.indexOf("(");
  if (parenIdx > 0) base = base.slice(0, parenIdx);
  base = base.trim();

  const alts = base
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const a of alts) {
    const t = a.toLowerCase().replace(/[^a-z0-9&'.\- ]/g, " ").replace(/\s+/g, " ").trim();
    if (t && t.length >= MIN_PHRASE_LENGTH && !/^\d+$/.test(t)) out.push(t);
  }
  return Array.from(new Set(out));
}

function cellText(v: unknown): string {
  return String(v ?? "").trim();
}

/** A column is a candidate key when its values are mostly unique and not
 *  numeric/date-heavy (e.g. "Deal Name", "Account Name" — not "Status"). */
function isKeyColumn(rows: Record<string, unknown>[], column: string): boolean {
  const values = rows.map((r) => cellText(r[column])).filter((x) => x !== "");
  if (values.length < MIN_MATCHES) return false;
  const distinct = new Set(values.map((v) => v.toLowerCase()));
  if (distinct.size / values.length < 0.6) return false;
  const numeric = values.filter((v) => /^-?[\d,.]+\s*$/.test(v)).length;
  return numeric / values.length < 0.5;
}

/** A column is a candidate text target when it is not numeric/date-heavy. */
function isTextColumn(rows: Record<string, unknown>[], column: string): boolean {
  const values = rows.map((r) => cellText(r[column])).filter((x) => x !== "");
  if (values.length === 0) return false;
  const numericOrDate = values.filter(
    (v) => /^-?[\d,.]+$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v),
  ).length;
  return numericOrDate / values.length < 0.8;
}

interface CoverageResult {
  equals: { matched: number; total: number; evidence: { left: string; right: string }[] };
  contains: { matched: number; total: number; evidence: { left: string; right: string }[] };
}

/** Measure how many of `leftCol`'s distinct values appear in `rightCol` (as an
 *  exact cell or as a substring), returning match counts + evidence samples. */
export function measureCoverage(
  leftRows: Record<string, unknown>[],
  leftCol: string,
  rightRows: Record<string, unknown>[],
  rightCol: string,
): CoverageResult {
  const leftValues = Array.from(
    new Set(leftRows.map((r) => cellText(r[leftCol])).filter((x) => x !== "")),
  );
  const rightCells = rightRows.map((r) => cellText(r[rightCol]).toLowerCase());

  const result: CoverageResult = {
    equals: { matched: 0, total: leftValues.length, evidence: [] },
    contains: { matched: 0, total: leftValues.length, evidence: [] },
  };

  for (const lv of leftValues) {
    const phrases = candidatePhrases(lv);
    if (phrases.length === 0) continue;
    const normalized = phrases.join(" ");
    let equalsHit: string | null = null;
    let containsHit: string | null = null;
    for (const rc of rightCells) {
      if (rc === "") continue;
      if (equalsHit === null && (rc === normalized || rc === lv.toLowerCase())) {
        equalsHit = rc;
      }
      if (containsHit === null && phrases.some((p) => rc.includes(p))) {
        containsHit = rc;
      }
      if (equalsHit && containsHit) break;
    }
    if (equalsHit !== null) {
      result.equals.matched++;
      if (result.equals.evidence.length < MAX_EVIDENCE) result.equals.evidence.push({ left: lv, right: equalsHit });
    }
    if (containsHit !== null) {
      result.contains.matched++;
      if (result.contains.evidence.length < MAX_EVIDENCE) result.contains.evidence.push({ left: lv, right: containsHit });
    }
  }

  return result;
}

/** Discover relationships across a set of loaded tables (deterministic). */
export function discoverRelationships(tables: DiscoveryTable[]): CatalogRelationship[] {
  const rels: CatalogRelationship[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = 0; j < tables.length; j++) {
      if (i === j) continue;
      const A = tables[i];
      const B = tables[j];
      for (const colA of A.columns) {
        if (!isKeyColumn(A.rows, colA)) continue;
        for (const colB of B.columns) {
          if (!isTextColumn(B.rows, colB)) continue;
          const cov = measureCoverage(A.rows, colA, B.rows, colB);

          let kind: CatalogRelationship["kind"] | null = null;
          let coverage = 0;
          let matched = 0;
          let evidence: { left: string; right: string }[] = [];
          if (cov.equals.matched >= MIN_MATCHES && cov.equals.matched / cov.equals.total >= EQUALS_COVERAGE_THRESHOLD) {
            kind = "equals";
            coverage = cov.equals.matched / cov.equals.total;
            matched = cov.equals.matched;
            evidence = cov.equals.evidence;
          } else if (
            cov.contains.matched >= MIN_MATCHES &&
            cov.contains.matched / cov.contains.total >= CONTAINS_COVERAGE_THRESHOLD
          ) {
            kind = "contains";
            coverage = cov.contains.matched / cov.contains.total;
            matched = cov.contains.matched;
            evidence = cov.contains.evidence;
          }
          if (!kind) continue;

          rels.push({
            id: `${A.name}.${colA}~${kind}~${B.name}.${colB}`,
            kind,
            left: { table: A.name, column: colA },
            right: { table: B.name, column: colB },
            confidence: coverage,
            coverage,
            source: "deterministic",
            evidence,
          });
        }
      }
    }
  }
  return rels;
}

export interface CoverageScanEntry {
  left: { table: string; column: string };
  right: { table: string; column: string };
  equals: { matched: number; total: number };
  contains: { matched: number; total: number };
}

/** Diagnostic scan: coverage for every key→text candidate pair that had at least
 *  one match but fell below the discovery thresholds. Surfaced by
 *  `list_relationships` when no relationship is found, so an empty catalog is
 *  self-explanatory instead of a silent `[]`. */
export function coverageScan(tables: DiscoveryTable[]): CoverageScanEntry[] {
  const out: CoverageScanEntry[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = 0; j < tables.length; j++) {
      if (i === j) continue;
      const A = tables[i];
      const B = tables[j];
      for (const colA of A.columns) {
        if (!isKeyColumn(A.rows, colA)) continue;
        for (const colB of B.columns) {
          if (!isTextColumn(B.rows, colB)) continue;
          const cov = measureCoverage(A.rows, colA, B.rows, colB);
          if (cov.equals.matched === 0 && cov.contains.matched === 0) continue;
          out.push({
            left: { table: A.name, column: colA },
            right: { table: B.name, column: colB },
            equals: { matched: cov.equals.matched, total: cov.equals.total },
            contains: { matched: cov.contains.matched, total: cov.contains.total },
          });
        }
      }
    }
  }
  return out;
}
