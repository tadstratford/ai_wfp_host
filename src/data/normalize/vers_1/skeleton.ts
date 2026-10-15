// Value-free grid skeleton — the only representation a Classifier (Jev) or LLM
// call ever sees. Emits column letters + structural type hints, never raw cell
// values, so classification stays cheap and privacy-safe.

export type CellHint = "date-like" | "number-like" | "long-text" | "short-code";

function hint(value: string): CellHint | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t)) return "date-like";
  if (/^-?\d[\d,.]*$/.test(t)) return "number-like";
  if (t.length > 24) return "long-text";
  return "short-code";
}

/** Skeleton line for one row: "r4: [a=date-like, b=date-like, d=long-text, …]". */
export function rowSkeleton(index: number, row: string[]): string {
  const parts: string[] = [];
  for (let c = 0; c < (row ?? []).length; c++) {
    const h = hint(row[c]);
    if (h) parts.push(`${String.fromCharCode(97 + c)}=${h}`);
  }
  return `r${index + 1}: [${parts.join(", ")}]`;
}

/** Skeleton for a window of rows (the Jev state for row-role classification). */
export function windowSkeleton(
  grid: string[][],
  center: number,
  windowSize: number,
): string {
  const half = Math.floor(windowSize / 2);
  const lines: string[] = [];
  for (let r = center - half; r <= center + half; r++) {
    if (r < 0 || r >= grid.length) continue;
    lines.push(rowSkeleton(r, grid[r] ?? []));
  }
  return lines.join("\n");
}
