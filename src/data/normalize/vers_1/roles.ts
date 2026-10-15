// Pass 2 — row-role classification.
//
// A deterministic regex seed classifies the easy rows (section keys, totals,
// dates, blanks); the Classifier (Jev) loop classifies the ambiguous remainder
// over a fixed role enum, one `choice` call per row, using a value-free window
// skeleton. This is the "tool in itself": a deterministic driver looping Jev
// categorical calls and feeding the answers to a deterministic assembler.

import type { NormalizeConfig, RowRole } from "./types";
import { windowSkeleton } from "./skeleton";

export interface RowClassification {
  row: number;
  role: RowRole;
  confidence: number;
  source: "deterministic" | "jev";
}

function nonEmpty(row: string[]): string[] {
  return (row ?? []).map((c) => (c ?? "").trim()).filter(Boolean);
}

/** Deterministic role seed. Returns null when ambiguous (defer to Jev). */
export function seedRole(row: string[], config: NormalizeConfig): RowRole | null {
  const cells = nonEmpty(row);
  if (cells.length === 0) return "blank";
  const first = cells[0];
  if (config.sectionKeyPattern.test(first) || config.balanceForwardPattern.test(first)) {
    return "section_key";
  }
  if (config.totalsPattern.test(first)) return "totals";
  if (config.datePattern.test(first)) return "detail";
  if (cells.length === 1 && !/^\d/.test(first)) return "title";
  return null;
}

/** Classify rows deterministically (Jev loop deferred to `classifyRowsWithJev`). */
export function classifyRows(
  grid: string[][],
  headerRow: number,
  config: NormalizeConfig,
): RowClassification[] {
  const out: RowClassification[] = [];
  for (let r = headerRow; r < grid.length; r++) {
    if (r === headerRow) {
      out.push({ row: r, role: "header", confidence: 1, source: "deterministic" });
      continue;
    }
    const role = seedRole(grid[r] ?? [], config);
    out.push({
      row: r,
      role: role ?? "detail",
      confidence: role ? 1 : 0,
      source: "deterministic",
    });
  }
  return out;
}

/** Minimal Classifier transport — `ask(state, questions) -> answers`. Mirrors the
 *  TypeSafe `askClassifier` shape without importing the provider layer. */
export type JevAsk = (
  state: unknown,
  questions: Record<string, unknown>,
) => Promise<{ role: RowRole; confidence: number }>;

const ROW_ROLE_CRITERIA: Record<RowRole, string> = {
  header: "Column names for a table",
  title: "A report/section title on a single cell",
  blank: "An empty or separator row",
  section_key: "A section header that labels the following detail rows (e.g. an account or entity)",
  detail: "A data/transaction row",
  continuation: "A detail row whose key is blank (belongs to the row above)",
  totals: "A subtotal/total row",
  footer: "A trailing note or report footer",
};

/** The Jev loop — one `choice` call per ambiguous row over the role enum. */
export async function classifyRowsWithJev(
  grid: string[][],
  headerRow: number,
  config: NormalizeConfig,
  ask: JevAsk,
): Promise<RowClassification[]> {
  const out: RowClassification[] = [];
  for (let r = headerRow; r < grid.length; r++) {
    if (r === headerRow) {
      out.push({ row: r, role: "header", confidence: 1, source: "deterministic" });
      continue;
    }
    const seeded = config.deterministicFirst ? seedRole(grid[r] ?? [], config) : null;
    if (seeded) {
      out.push({ row: r, role: seeded, confidence: 1, source: "deterministic" });
      continue;
    }
    if (config.sampleMaxRows > 0 && r - headerRow > config.sampleMaxRows) {
      out.push({ row: r, role: "detail", confidence: 0.5, source: "jev" });
      continue;
    }
    const state = { window: windowSkeleton(grid, r, config.contextWindowSize), target: `r${r + 1}` };
    const questions = {
      role: {
        type: "choice",
        instructions: "What role does the target row play in the report?",
        criteria: ROW_ROLE_CRITERIA,
      },
    };
    try {
      const ans = await ask(state, questions);
      out.push({ row: r, role: ans.role, confidence: ans.confidence, source: "jev" });
    } catch {
      out.push({ row: r, role: "detail", confidence: 0, source: "jev" });
    }
  }
  return out;
}
