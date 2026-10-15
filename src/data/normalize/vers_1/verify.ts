// Pass 4 — table verification. Deterministic sanity scoring for v1; a Jev
// `score` per table (and an LLM value-free escape hatch) is the Phase 2 path.

import type { NormalizeConfig, NormalizedDataSet } from "./types";

export function verifyTables(
  dataSet: NormalizedDataSet,
  config: NormalizeConfig,
): NormalizedDataSet {
  if (!config.verifyTables) return dataSet;
  const tableScores: Record<string, number> = {};
  for (const t of dataSet.tables) {
    tableScores[t.name] = t.rows.length > 0 ? 5 : 1;
  }
  return { ...dataSet, confidence: { ...dataSet.confidence, tableScores } };
}
