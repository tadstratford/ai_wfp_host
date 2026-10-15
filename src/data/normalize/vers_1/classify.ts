// Shape classification — deterministic fingerprint matching over the registry.
//
// Returns candidate interpretations for a grid. When no fingerprint matches,
// falls back to a single "flat_table" candidate (treat as plain rows). Jev
// shape-choice (a structured `choice` over the registry) can extend this later
// for formats with no deterministic fingerprint; it must remain value-free.

import type { ShapeCandidate } from "./types";
import { registerShapes } from "./specs";

export function classifyShapes(grid: string[][]): ShapeCandidate[] {
  const matches: ShapeCandidate[] = [];
  for (const spec of registerShapes()) {
    if (spec.fingerprint && spec.fingerprint(grid)) {
      matches.push({ specId: spec.id, label: spec.label, confidence: 1 });
    }
  }
  if (matches.length === 0) {
    matches.push({ specId: "flat_table", label: "Flat table", confidence: 0.5 });
  }
  return matches;
}
