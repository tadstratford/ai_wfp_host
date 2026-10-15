// QBO routing — recognized QBO reports are delegated to the (separate) QBO
// parsers, which already emit normalized shapes. The generic loop never sees QBO.

import { looksLikeQbo } from "@data/qbo/recognize";
import { detectQboFromContent } from "@data/qbo/ingest";
import { parseQboReport, qboReportToTable } from "@data/qbo/toTable";
import type { NormalizeConfig, NormalizedDataSet, NormalizedTable } from "./types";

export function routeQbo(
  content: string,
  config: NormalizeConfig,
): NormalizedDataSet | null {
  if (!looksLikeQbo(content)) return null;
  const detected = detectQboFromContent(content);
  if (!detected) return null;

  const report = parseQboReport(detected.kind, detected.cells, "");
  const { columns, rows } = qboReportToTable(detected.kind, report);

  const table: NormalizedTable = {
    name: detected.kind,
    columns,
    columnTypes: {},
    rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]]))),
  };

  return {
    tables: [table],
    config,
    engine: "qbo",
    confidence: { rowRoles: [], tableScores: {} },
    unresolved: [],
  };
}
