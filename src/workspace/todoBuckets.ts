// Todo/plan sort helper — for the new `.wfp` shape where todos is a flat
// TodoEntry[] and plan is a separate PlanEntry[].
//
// Both nodes are just flat arrays sorted by sort_order. The old bucket helpers
// (bucketOf, flattenBuckets, toBuckets) are removed — todos no longer live in
// a { plan, workflow, other } structure.

import type { TodoEntry } from "wfp-format";

/** Sort entries by sort_order (stable for equal values). */
export function sortEntries(entries: TodoEntry[]): TodoEntry[] {
  return [...entries].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
