// normalize/vers_1 — entry point. `normalizeData` reduces non-conforming tabular
// content to normalized related tables (JSON arrays with foreign keys).

import { stage } from "@data/stage";
import { DEFAULT_CONFIG, resolveConfig, type Preset } from "./config";
import { ingestContent } from "./ingest";
import { routeQbo } from "./qboRoute";
import { findHeaderRow } from "./header";
import { classifyRows } from "./roles";
import { assembleNormalized } from "./assemble";
import { verifyTables } from "./verify";
import { classifyShapes } from "./classify";
import type { NormalizeConfig, NormalizedDataSet, NormalizedTable } from "./types";

export type {
  ContinuationMode,
  FlatTable,
  KeyInfo,
  ShapeSpec,
  ShapeCandidate,
  RowRole,
  ColumnRole,
  NormalizeConfig,
  NormalizedTable,
  NormalizedDataSet,
} from "./types";
export { DEFAULT_CONFIG, resolveConfig, presets } from "./config";
export type { Preset } from "./config";
export { longestCommonTokenRun } from "./entityKey";
export { statementDetailSpec, registerShapes, extractEntityKey, findMemo } from "./specs";
export { applyShape, firstNonEmpty } from "./apply";
export { classifyShapes } from "./classify";
export { ingestContent } from "./ingest";
export { findHeaderRow } from "./header";
export { mapColumnRoles } from "./columns";
export { classifyRows, classifyRowsWithJev, seedRole } from "./roles";
export type { RowClassification, JevAsk } from "./roles";
export { assembleNormalized } from "./assemble";
export { verifyTables } from "./verify";
export { routeQbo } from "./qboRoute";
export { rowSkeleton, windowSkeleton } from "./skeleton";

function empty(config: NormalizeConfig): NormalizedDataSet {
  return {
    tables: [],
    config,
    engine: "deterministic",
    confidence: { rowRoles: [], tableScores: {} },
    unresolved: [],
  };
}

/** Normalize raw content (csv/xlsx→csv/tsv) into related tables. QBO reports
 *  are routed to the QBO parsers; otherwise the deterministic pipeline runs. */
export function normalizeData(
  content: string,
  config: NormalizeConfig = DEFAULT_CONFIG,
): NormalizedDataSet {
  const qbo = routeQbo(content, config);
  if (qbo) return qbo;

  const ingested = ingestContent(content);
  if (!ingested) return empty(config);
  const { grid } = ingested;

  const headerRow = findHeaderRow(grid);
  if (headerRow < 0) return empty(config);

  // Block-structured shape (statement detail) → normalized accounts + transactions.
  const candidates = classifyShapes(grid);
  if (candidates.some((c) => c.specId === "statement_detail")) {
    const classes = classifyRows(grid, headerRow, config);
    const tables = assembleNormalized(grid, classes, config);
    return verifyTables(
      {
        tables,
        config,
        engine: "deterministic",
        confidence: {
          rowRoles: classes.map((c) => ({ row: c.row, role: c.role, confidence: c.confidence })),
          tableScores: {},
        },
        unresolved: [],
      },
      config,
    );
  }

  // Generic flat table → one normalized table from the loader's staging.
  const staged = stage(content);
  const first = staged.tables[0];
  if (!first) return empty(config);
  const table: NormalizedTable = {
    name: "rows",
    columns: first.columns,
    columnTypes: first.columnTypes as Record<string, "number" | "boolean" | "string">,
    rows: first.rows,
  };
  return verifyTables(
    {
      tables: [table],
      config,
      engine: "deterministic",
      confidence: { rowRoles: [], tableScores: {} },
      unresolved: [],
    },
    config,
  );
}

/** Convenience: normalize with a named preset + overrides. */
export function normalizeDataWithPreset(
  content: string,
  presetName?: string,
  overrides?: Preset,
): NormalizedDataSet {
  return normalizeData(content, resolveConfig(presetName, overrides));
}
