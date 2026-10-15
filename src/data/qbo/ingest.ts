// QBO ingest detection — shared between the dedicated QBO tab load path.
//
// Builds a cell-address map directly from the raw text and runs recognition.
// No reliance on the generic data auto-detector (which may classify a QBO
// report as a single table rather than a multi-table `json_cells` map).

import { buildCellMap } from "../stage";
import { recognizeQboReport, looksLikeQbo, type QboReportKind } from "./recognize";

export interface DetectedQbo {
  kind: QboReportKind;
  /** Short human label (e.g. "QuickBooks General Ledger"). */
  label: string;
  cells: Record<string, string>;
  rowCount: number;
}

/** Detect a QBO report from raw CSV/text content. */
export function detectQboFromContent(content: string): DetectedQbo | null {
  if (!looksLikeQbo(content)) return null;
  const cellMap = buildCellMap(content);
  if (!cellMap) return null;
  const rec = recognizeQboReport(cellMap.cells);
  if (!rec) return null;
  return { kind: rec.kind, label: rec.label, cells: cellMap.cells, rowCount: cellMap.rowCount };
}
