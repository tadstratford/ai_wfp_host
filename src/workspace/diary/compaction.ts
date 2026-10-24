// Diary compaction — deterministic roll-up (no LLM, no I/O).
//
// Every ENTRIES_PER_SUMMARY entries are condensed into one DiarySummary;
// every SUMMARIES_PER_NARRATIVE summaries roll into one DiaryNarrative chunk.
// The `batchHash` (hash of the replaced entries/summaries) keeps tamper-evidence
// intact even though the raw entries are dropped (lossy).

import { randomUUID } from "node:crypto";
import type { DiaryEntry, DiarySummary, DiaryNarrative } from "wfp-format";
import { hashValue } from "../hash";

export const ENTRIES_PER_SUMMARY = 60;
export const SUMMARIES_PER_NARRATIVE = 20;
/** Max entry summaries retained in a summary's `sample` (for LLM highlights). */
export const SAMPLE_LIMIT = 4;

function entryText(e: DiaryEntry): string {
  const bits = [e.summary];
  if (e.entities?.length) bits.push(`(${e.entities.join(", ")})`);
  return bits.join(" ");
}

export function summarizeEntries(entries: DiaryEntry[]): DiarySummary {
  const byActor: Record<string, number> = {};
  const byEntity: Record<string, number> = {};
  const byCapability: Record<string, number> = {};
  let hasAmount = false;
  let total = 0;
  for (const e of entries) {
    byActor[e.actor] = (byActor[e.actor] ?? 0) + 1;
    for (const en of e.entities ?? []) byEntity[en] = (byEntity[en] ?? 0) + 1;
    const cap = e.producer ?? "unknown";
    byCapability[cap] = (byCapability[cap] ?? 0) + 1;
    if (typeof e.amount === "number") {
      hasAmount = true;
      total += e.amount;
    }
  }

  return {
    id: randomUUID(),
    from: entries[0]?.eventAt ?? "",
    to: entries[entries.length - 1]?.eventAt ?? "",
    count: entries.length,
    batchHash: hashValue(entries),
    byActor,
    byEntity,
    byCapability,
    totals: hasAmount ? { amount: total } : undefined,
    sample: entries.slice(-SAMPLE_LIMIT).map(entryText),
    highlights: [],
  };
}

export function summarizeSummaries(summaries: DiarySummary[]): DiaryNarrative {
  return {
    id: randomUUID(),
    from: summaries[0]?.from ?? "",
    to: summaries[summaries.length - 1]?.to ?? "",
    count: summaries.length,
    batchHash: hashValue(summaries),
    highlights: [],
  };
}
