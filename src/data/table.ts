/**
 * Derive a flat table (array of row objects) from a producer's raw output.
 *
 * Tabular MCP tools wrap their rows in an object (`get_data` → `{ rows }`,
 * `aggregate_data` → `{ groups }`). When a result is persisted as a table, this
 * helper unwraps those envelopes and flattens nested `key`/`measures` row shapes
 * (e.g. `{ key: {Account: "1200"}, measures: {Sum: 144660}, count: 4 }` →
 * `{ Account: "1200", Sum: 144660, count: 4 }`).
 */

/** Row-object keys that hold the underlying array of rows. */
const ROW_KEYS = ["rows", "groups", "items", "data", "results"];

/** True when a row carries a nested `key`/`measures` shape to flatten. */
function hasNestedShape(row: unknown): row is Record<string, unknown> {
  return (
    !!row &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    ("key" in (row as object) || "measures" in (row as object))
  );
}

export function extractTable(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;
  for (const key of ROW_KEYS) {
    const candidate = obj[key];
    if (!Array.isArray(candidate)) continue;

    if (candidate.some(hasNestedShape)) {
      return candidate.map((row) => {
        const { key, measures, ...rest } = (row ?? {}) as Record<string, unknown>;
        const k = key && typeof key === "object" && !Array.isArray(key) ? key : {};
        const m =
          measures && typeof measures === "object" && !Array.isArray(measures)
            ? measures
            : {};
        return { ...k, ...m, ...rest };
      });
    }
    return candidate;
  }

  return null;
}
