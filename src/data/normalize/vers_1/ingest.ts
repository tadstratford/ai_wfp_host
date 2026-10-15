// Ingest — raw content (xlsx→csv, csv, tsv) → a dense grid + cell map.
// Reuses `stage.ts` cell-map primitives; xlsx is converted to csv upstream
// (see userDataLoadHandler) before it reaches the normalize pipeline.

import { buildCellMap, cellMapToGrid } from "@data/stage";

export interface Ingested {
  grid: string[][];
  cells: Record<string, string>;
  rowCount: number;
}

export function ingestContent(content: string): Ingested | null {
  if (!content || typeof content !== "string") return null;
  const cm = buildCellMap(content);
  if (!cm || cm.rowCount === 0) return null;
  return { grid: cellMapToGrid(cm.cells), cells: cm.cells, rowCount: cm.rowCount };
}
