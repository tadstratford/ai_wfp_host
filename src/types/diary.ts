// Diary — a compact, timestamped, actor-attributed narrative of what is
// happening in a workspace ("the story, and by whom"). Schema-agnostic: time
// is a real timestamp and everything else is free-form keys, so any capability
// (weeks, quarters, any data) can emit entries.
//
// Three tiers with rolling compaction (lossy — raw entries are dropped after
// summarization):
//   entries   → hot window (≤ 60), full detail
//   summaries → every 60 entries condensed into one (≤ 20)
//   narrative → every 20 summaries rolled into the accumulating whole-file diary

export interface DiaryEntry {
  id: string;
  /** Real timestamp — "last year" = now - 1y, never a fiscal period. */
  eventAt: string;
  actor: string;
  producer?: string;
  producerVersion?: string;
  /** The story sentence (human/LLM-written). */
  summary: string;
  /** Free-form keys ("Building Maintenance", "Alpha Fund") — no fixed schema. */
  entities?: string[];
  tags?: string[];
  amount?: number;
}

export interface DiarySummary {
  id: string;
  from: string;
  to: string;
  count: number;
  /** Hash of the raw entries this summary replaced — tamper-evidence survives the drop. */
  batchHash: string;
  byActor: Record<string, number>;
  byEntity: Record<string, number>;
  byCapability: Record<string, number>;
  totals?: Record<string, number>;
  /** A small bounded sample of the replaced entries (for LLM highlight generation). */
  sample: string[];
  /** LLM-generated narrative highlights (filled lazily; may be empty). */
  highlights: string[];
}

export interface DiaryNarrative {
  id: string;
  from: string;
  to: string;
  count: number;
  /** Hash of the summaries this narrative chunk replaced. */
  batchHash: string;
  /** LLM-generated narrative (filled lazily; may be empty). */
  highlights: string[];
}

export interface Diary {
  entries: DiaryEntry[];
  summaries: DiarySummary[];
  narrative: DiaryNarrative[];
}
