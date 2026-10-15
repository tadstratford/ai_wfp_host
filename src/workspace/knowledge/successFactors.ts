/**
 * Success Factors — Glass Box slice 1 (see docs/glass-box-spec.md)
 *
 * A knowledge pack can declare the checkable conditions that mean "this rule was
 * applied correctly." They live as a `## Success Factors` section in the pack's
 * markdown content — a single source of truth that travels in the .wfp and is
 * author-reviewable in the Knowledge panel — one factor per line:
 *
 *   ## Success Factors
 *   - [deterministic] The journal entry balances (debits = credits).
 *   - [audit] The allocation split matches the percentages in the client agreement.
 *
 * `deterministic` = a computable assertion checked in code.
 * `audit`         = a judgment delegated to a separate LLM audit pass.
 *
 * The machine audit (a later slice) turns these factors into a binary
 * PASS / NEEDS REVIEW verdict — never a confidence score.
 *
 * This module only parses the section. It performs no NLP: it reads the strict,
 * machine-authored `- [mode] condition` format we emit, and ignores anything else.
 */

export type SuccessFactorMode = "deterministic" | "audit";

export interface SuccessFactor {
  mode: SuccessFactorMode;
  condition: string;
}

/** The canonical heading text packs use to open the section. */
export const SUCCESS_FACTORS_HEADING = "Success Factors";

// A markdown ATX heading line, e.g. "## Success Factors" — captures the title text.
// ATX only: setext underline headings ("Success Factors\n===") are not recognized;
// the build-helper and manual placeholder always emit ATX, so this is sufficient.
const HEADING_RE = /^#{1,6}\s+(.+?)\s*#*\s*$/;
// A factor line: "- [deterministic] ..." or "* [audit] ..." (mode is case-insensitive).
const FACTOR_RE = /^\s*[-*]\s*\[(deterministic|audit)\]\s*(.+)$/i;

function isSuccessFactorsHeading(text: string): boolean {
  return text.trim().toLowerCase() === SUCCESS_FACTORS_HEADING.toLowerCase();
}

/**
 * Extract the success factors from a knowledge pack's markdown content.
 * Returns [] when the pack has no `## Success Factors` section.
 */
export function parseSuccessFactors(content: string): SuccessFactor[] {
  const lines = (content ?? "").split(/\r?\n/);
  const factors: SuccessFactor[] = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      // Any heading either opens the section (if it's "Success Factors") or
      // closes it (any other heading ends factor collection).
      inSection = isSuccessFactorsHeading(heading[1]);
      continue;
    }
    if (!inSection) continue;

    const m = line.match(FACTOR_RE);
    if (m) {
      const condition = m[2].trim();
      if (condition) {
        factors.push({ mode: m[1].toLowerCase() as SuccessFactorMode, condition });
      }
    }
  }

  return factors;
}

/** True when the pack declares at least one success factor. */
export function hasSuccessFactors(content: string): boolean {
  return parseSuccessFactors(content).length > 0;
}

/** Counts by mode — used to surface a quick "N factors" signal in the UI. */
export function summarizeSuccessFactors(content: string): {
  total: number;
  deterministic: number;
  audit: number;
} {
  const factors = parseSuccessFactors(content);
  return {
    total: factors.length,
    deterministic: factors.filter((f) => f.mode === "deterministic").length,
    audit: factors.filter((f) => f.mode === "audit").length,
  };
}
