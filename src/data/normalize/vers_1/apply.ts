// Shape application — deterministic collapse of a grid into a flat table using
// a ShapeSpec. No LLM involved; pure and unit-testable.

import type { FlatTable, KeyInfo, ShapeSpec } from "./types";

/** The first non-empty cell in a row (the account/key cell for block layouts). */
export function firstNonEmpty(row: string[]): string {
  return ((row ?? []).find((c) => (c ?? "").trim() !== "") ?? "").trim();
}

function firstText(row: string[]): string {
  return (row ?? []).map((c) => (c ?? "").trim()).filter(Boolean).join(" ");
}

/** Walk a grid and collapse it to a flat table per the spec's continuation mode. */
export function applyShape(grid: string[][], spec: ShapeSpec): FlatTable {
  const rows: string[][] = [];
  let currentKey: KeyInfo | null = null;

  for (const row of grid) {
    // A new block key (account / section header).
    if (spec.isKeyRow && spec.isKeyRow(row)) {
      const keyText = firstNonEmpty(row);
      currentKey = {
        keyText,
        entityKey: spec.entityKey ? spec.entityKey(keyText) : null,
      };
      continue;
    }

    if (!currentKey) continue;
    if (spec.isDataRow && !spec.isDataRow(row)) continue;

    // entity-id mode: only attach when the normalized keys match.
    if (spec.continuation === "entity-id" && spec.entityKey) {
      const rowKey = spec.entityKey(firstText(row));
      if (
        currentKey.entityKey === null ||
        rowKey === null ||
        rowKey !== currentKey.entityKey
      ) {
        continue;
      }
    }

    rows.push(spec.mapRow(currentKey, row));
  }

  return { columns: spec.outputColumns, rows };
}
