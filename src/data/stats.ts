// Deterministic aggregation over tabular data — pure functions, no app imports.
// Used by the `aggregate_data` MCP tool to compute grouped sums/counts/avg/min/max
// over a large dataset without ever materializing typed rows in bulk.

import { parseNumber, scanDataRows, type StagedLarge } from "./stage";
import { cellRowMatches, type FilterClause } from "./filter";

export type AggregateFn = "sum" | "count" | "avg" | "min" | "max";

export interface AggregateMeasure {
  column: string;
  fn: AggregateFn;
}

export interface AggregateGroup {
  /** group-by column values (raw; the caller masks them before the LLM sees them). */
  key: Record<string, string> | null;
  /** `${fn}_${column}` → computed value. */
  measures: Record<string, number | null>;
  /** number of source rows in this group. */
  count: number;
}

/** Column index lookup by name (strict, trimmed). */
function columnIndices(columns: string[], names: string[]): number[] {
  const map = new Map(columns.map((c, i) => [c, i]));
  return names.map((n) => map.get(n) ?? -1).filter((i) => i >= 0);
}

/**
 * Aggregate cell-array rows by group columns. Rows are plain string[][]; number
 * parsing is deterministic (currency/commas/parentheses handled by parseNumber).
 */
export function aggregateCells(
  columns: string[],
  cellRows: string[][],
  groupBy: string[],
  measures: AggregateMeasure[],
  limit = 50,
): { groups: AggregateGroup[]; totalGroups: number } {
  const groupIdx = columnIndices(columns, groupBy);
  const measureIdx = measures
    .map((m) => ({ ...m, idx: columns.indexOf(m.column) }))
    .filter((m) => m.idx >= 0);

  interface Acc {
    key: Record<string, string>;
    sums: Record<string, number>;
    mins: Record<string, number>;
    maxs: Record<string, number>;
    /** Non-null numeric values per column, counted once per row per column —
     *  independent of how many measures reference the column (the previous
     *  per-measure `counts` bucket inflated counts/avg denominators whenever
     *  multiple measures targeted the same column). */
    nonNullCounts: Record<string, number>;
    rowCount: number;
  }

  const groups = new Map<string, Acc>();

  for (const cells of cellRows) {
    const key: Record<string, string> = {};
    if (groupIdx.length > 0) {
      for (const g of groupIdx) key[columns[g]] = (cells[g] ?? "").trim();
    }
    const k = JSON.stringify(key);
    let acc = groups.get(k);
    if (!acc) {
      acc = { key, sums: {}, mins: {}, maxs: {}, nonNullCounts: {}, rowCount: 0 };
      groups.set(k, acc);
    }
    acc.rowCount++;

    // Dedupe by column: a numeric column is parsed and accumulated once per
    // row, regardless of how many measures (sum/count/avg/min/max) target it.
    // Sharing per-measure accumulators inflated sums and counts when multiple
    // measures referenced the same column.
    const seenCols = new Set<string>();
    for (const m of measureIdx) {
      if (seenCols.has(m.column)) continue;
      seenCols.add(m.column);

      const raw = (cells[m.idx] ?? "").trim();
      const num = parseNumber(raw);
      if (num === null) continue;

      acc.nonNullCounts[m.column] = (acc.nonNullCounts[m.column] ?? 0) + 1;
      acc.sums[m.column] = (acc.sums[m.column] ?? 0) + num;
      acc.mins[m.column] =
        acc.mins[m.column] === undefined ? num : Math.min(acc.mins[m.column], num);
      acc.maxs[m.column] =
        acc.maxs[m.column] === undefined ? num : Math.max(acc.maxs[m.column], num);
    }
  }

  const out: AggregateGroup[] = [];
  for (const acc of groups.values()) {
    const measuresOut: Record<string, number | null> = {};
    for (const m of measureIdx) {
      const c = acc.nonNullCounts[m.column] ?? 0;
      switch (m.fn) {
        case "count":
          measuresOut[`count_${m.column}`] = c;
          break;
        case "sum":
          measuresOut[`sum_${m.column}`] = acc.sums[m.column] ?? null;
          break;
        case "avg":
          measuresOut[`avg_${m.column}`] = c ? (acc.sums[m.column] ?? 0) / c : null;
          break;
        case "min":
          measuresOut[`min_${m.column}`] = acc.mins[m.column] ?? null;
          break;
        case "max":
          measuresOut[`max_${m.column}`] = acc.maxs[m.column] ?? null;
          break;
      }
    }
    out.push({
      key: Object.keys(acc.key).length > 0 ? acc.key : null,
      measures: measuresOut,
      count: acc.rowCount,
    });
  }

  out.sort((a, b) => b.count - a.count);
  return { groups: out.slice(0, limit), totalGroups: out.length };
}

/** Aggregate a large CSV in one streaming pass (skipping report scaffolding,
 *  forward-filling continuation rows), without materializing typed rows. An
 *  optional `filter` excludes rows before grouping (deterministic predicate). */
export function aggregateLarge(
  content: string,
  staged: StagedLarge,
  groupBy: string[],
  measures: AggregateMeasure[],
  limit = 50,
  filter?: FilterClause[],
): { groups: AggregateGroup[]; totalGroups: number } {
  const cellRows: string[][] = [];
  scanDataRows(
    content,
    { headerIndex: staged.headerIndex, keyColumns: staged.keyColumns },
    (cells) => {
      if (filter && filter.length > 0 && !cellRowMatches(staged.columns, cells, filter)) {
        return;
      }
      cellRows.push(cells);
    },
  );
  return aggregateCells(staged.columns, cellRows, groupBy, measures, limit);
}
