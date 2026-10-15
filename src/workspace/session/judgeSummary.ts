// judgeSummary — compact per-session summary of check_data / judge_data
// results, persisted so the session list can show a one-line verdict without
// opening the run.

export interface JudgeSummary {
  /** check_data: number of dataset-level yes/no checks asked. */
  checks?: number;
  /** check_data: number of checks the Classifier answered "no" (or errored). */
  issues?: number;
  /** judge_data: number of rows classified. */
  judged?: number;
}

/** Derive a compact summary from a tool's parsed result, or null if the tool
 *  (or result shape) doesn't map to a summary. */
export function summarizeJudgeResult(
  toolName: string,
  parsed: unknown,
): JudgeSummary | null {
  if (toolName === "check_data") {
    if (!Array.isArray(parsed)) return null;
    let checks = 0;
    let issues = 0;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const c = item as { id?: unknown; noul?: unknown; error?: unknown };
      if (typeof c.id !== "string") continue;
      checks++;
      const noul = c.noul;
      if (typeof noul === "number") {
        if (noul < 0.5) issues++;
      } else if (c.error) {
        issues++;
      }
    }
    if (checks === 0) return null;
    return { checks, issues };
  }

  if (toolName === "judge_data") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const summary = (parsed as { summary?: { total?: unknown } }).summary;
    const total = typeof summary?.total === "number" ? summary.total : undefined;
    if (total === undefined) return null;
    return { judged: total };
  }

  return null;
}

/** Render a summary as a short human-readable line, or null when absent. */
export function formatJudgeSummary(summary: JudgeSummary | null | undefined): string | null {
  if (!summary) return null;
  if (summary.checks !== undefined) {
    const checkLabel = `${summary.checks} check${summary.checks === 1 ? "" : "s"}`;
    const issues = summary.issues ?? 0;
    if (issues > 0) {
      return `${checkLabel} · ${issues} issue${issues === 1 ? "" : "s"}`;
    }
    return `${checkLabel} · all clear`;
  }
  if (summary.judged !== undefined) {
    return `${summary.judged} row${summary.judged === 1 ? "" : "s"} judged`;
  }
  return null;
}
