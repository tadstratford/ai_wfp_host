// Deterministic rule application — the engine behind the `classify_data` and
// `split_data` tools.
//
// `evaluateRuleSpec` is pure (no app imports, no LLM): given a structured spec
// (classify / flag / measure), it applies it to the provided tables and returns
// classifications / flags / allocations — or `applied: false` with a `reason` +
// `needs` list when the data the spec needs is missing.
//
// The spec itself is produced by the chat LLM (it picks the tool + the exact
// columns); this module only does the arithmetic on an already-specified spec.

import type { RuleApplication, RuleSpec, MeasureSplit, RuleFilterClause, RuleFlagResult } from "wfp-format";
import { applyRowFilter, rowMatchesFilter, type FilterClause } from "./filter";
import { splitAmount, round2 } from "./split";
import { parseAmount } from "./profile";
import type { DiscoveryTable } from "./catalog/discover";

const MAX_RESULT_ROWS = 500;

function missingColumns(table: DiscoveryTable, clauses: RuleFilterClause[] | undefined): string[] {
  const cols = new Set(table.columns);
  const missing = new Set<string>();
  for (const c of clauses ?? []) if (!cols.has(c.column)) missing.add(c.column);
  return Array.from(missing).map((c) => `column:${c}`);
}

function awaiting(evaluatedAt: string, needs: string[]): RuleApplication {
  return { evaluatedAt, applied: false, reason: "awaiting data", needs };
}

function evaluateClassify(
  spec: RuleSpec,
  table: DiscoveryTable,
  evaluatedAt: string,
): RuleApplication {
  const colNeeds = missingColumns(table, (spec.outcomes ?? []).flatMap((o) => o.when));
  if (colNeeds.length) return awaiting(evaluatedAt, colNeeds);

  const buckets = new Map<string, { count: number; rows: Record<string, unknown>[] }>();
  const order: string[] = [];
  for (const row of table.rows) {
    let outcome: string | null = spec.defaultOutcome ?? null;
    for (const o of spec.outcomes ?? []) {
      if (rowMatchesFilter(row, o.when as FilterClause[])) {
        outcome = o.outcome;
        break;
      }
    }
    const key = outcome ?? "(unclassified)";
    let b = buckets.get(key);
    if (!b) {
      b = { count: 0, rows: [] };
      buckets.set(key, b);
      order.push(key);
    }
    b.count++;
    if (b.rows.length < MAX_RESULT_ROWS) b.rows.push(row);
  }

  return {
    evaluatedAt,
    applied: true,
    classifications: order.map((o) => ({
      outcome: o,
      count: buckets.get(o)!.count,
      rows: buckets.get(o)!.rows,
    })),
  };
}

function evaluateFlag(
  spec: RuleSpec,
  table: DiscoveryTable,
  evaluatedAt: string,
): RuleApplication {
  const colNeeds = missingColumns(table, spec.when);
  if (colNeeds.length) return awaiting(evaluatedAt, colNeeds);

  const rows = applyRowFilter(table.rows, spec.when as FilterClause[]);
  const flags: RuleFlagResult[] = [
    { reason: spec.reason ?? "flagged", count: rows.length, rows: rows.slice(0, MAX_RESULT_ROWS) },
  ];
  return { evaluatedAt, applied: true, flags };
}

function resolveSplit(spec: RuleSpec, byName: Map<string, DiscoveryTable>, needs: string[]): MeasureSplit[] | null {
  if (spec.split && spec.split.length > 0) return spec.split;
  if (!spec.splitTable) {
    needs.push("split:percentages not provided and no splitTable");
    return null;
  }
  const t = byName.get(spec.splitTable);
  if (!t) {
    needs.push(`table:${spec.splitTable}`);
    return null;
  }
  const ec = spec.splitEntityColumn;
  const pc = spec.splitPercentColumn;
  if (!ec || !t.columns.includes(ec)) {
    needs.push(`column:${ec ?? ""}`);
    return null;
  }
  if (!pc || !t.columns.includes(pc)) {
    needs.push(`column:${pc ?? ""}`);
    return null;
  }

  const out = t.rows
    .map((r) => ({ entity: String(r[ec] ?? "").trim(), percent: Number(r[pc]) || 0 }))
    .filter((p) => p.entity !== "" && Number.isFinite(p.percent));
  if (out.length === 0) {
    needs.push("split:no percentages found");
    return null;
  }
  return out;
}

function evaluateMeasure(
  spec: RuleSpec,
  table: DiscoveryTable,
  byName: Map<string, DiscoveryTable>,
  evaluatedAt: string,
): RuleApplication {
  const needs: string[] = [];
  if (!spec.amountColumn || !table.columns.includes(spec.amountColumn)) {
    needs.push(`column:${spec.amountColumn ?? ""}`);
  }
  needs.push(...missingColumns(table, spec.when));
  if (needs.length) return awaiting(evaluatedAt, needs);

  const split = resolveSplit(spec, byName, needs);
  if (!split) return awaiting(evaluatedAt, needs);

  const rows = applyRowFilter(table.rows, spec.when as FilterClause[]);
  let total = 0;
  for (const r of rows) {
    const a = parseAmount(r[spec.amountColumn!]);
    if (a !== null) total += a;
  }
  total = round2(total);

  const shares = splitAmount(total, split);
  return {
    evaluatedAt,
    applied: true,
    allocations: shares.map((s) => ({ entity: s.entity, total: round2(s.amount) })),
    total,
  };
}

/** Apply a spec (classify / flag / measure) to the provided tables. Pure. */
export function evaluateRuleSpec(spec: RuleSpec, tables: DiscoveryTable[]): RuleApplication {
  const evaluatedAt = new Date().toISOString();
  const byName = new Map(tables.map((t) => [t.name, t]));

  if (!spec.table || !byName.has(spec.table)) {
    return awaiting(evaluatedAt, [`table:${spec.table ?? ""}`]);
  }
  const table = byName.get(spec.table)!;

  switch (spec.kind) {
    case "classify":
      return evaluateClassify(spec, table, evaluatedAt);
    case "flag":
      return evaluateFlag(spec, table, evaluatedAt);
    case "measure":
      return evaluateMeasure(spec, table, byName, evaluatedAt);
    default:
      return { evaluatedAt, applied: false, reason: `unknown spec kind` };
  }
}
