// Pass 0 — header row detection (deterministic). Reuses the loader's header
// heuristic; a Jev `noul` fallback can be added for ambiguous cases.

import { isHeaderLike } from "@data/stage";

export function findHeaderRow(grid: string[][], maxScan = 25): number {
  const scan = Math.min(grid.length, maxScan);
  for (let r = 0; r < scan; r++) {
    if (isHeaderLike(grid[r] ?? [])) return r;
  }
  return -1;
}
