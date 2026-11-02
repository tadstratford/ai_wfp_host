/**
 * Story — the meta-plan type. A story is an ordered list of beats; each beat
 * names a skill (whose tools follow via `catalog_skill_tools`) plus a `template`
 * id that maps to a deterministic (or LLM-composed) plan builder.
 *
 * These types are server-wide (used by the catalog and the chat orchestrator),
 * which is why they live here rather than under a specific chat version.
 */

/** The code that assembles a beat's plan/artifact, referenced by stable id. */
export type BeatTemplateId =
  | "persona"        // read the persona rule + announce focus
  | "clarify"        // ask the user to resolve ambiguity (clarify skill)
  | "skim"           // minimal read over the data (quick-fact setup)
  | "map"            // relationship map + scope + table details (setup)
  | "verdicts"       // red/yellow/green verdicts + variance strip (status)
  | "findings"       // pinpoint the gaps ("what needs to change")
  | "remediation"    // ordered remediation plan
  | "journal"        // execute the write (journal / adjustment)
  | "report"         // downloadable self-contained report (resolution)
  | "answer";        // inline answer, no file (quick-fact resolution)

/** Per-beat Jev verification criterion. */
export type VerifyRule =
  | "none"                // no verification (presentation-only beat)
  | "accurate"            // figures match the computed evidence
  | "grounded-actionable" // plan is grounded in evidence + actionable
  | "complete-accurate"   // deliverable is complete + accurate
  | "balanced";           // write is balanced (debits = credits)

export interface Beat {
  /** Stable beat id (unique within an archetype). */
  id: string;
  /** The authoritative skill for this beat — its declared tools follow. Omit for
   *  the `generic` catch-all beat, which uses all enabled skills. */
  skill?: string;
  /** The code template that assembles this beat's plan/artifact. */
  template: BeatTemplateId;
  /** Per-beat Jev verification criterion. */
  verify: VerifyRule;
  /** True when this beat crosses the write-approval gate. */
  write?: boolean;
}

export interface StoryArchetype {
  id: string;
  description: string;
  /** Classifier fan-out nouls: id → instructions. Jev answers every archetype's
   *  nouls in one call; the highest-scoring archetype wins. */
  nouls: Record<string, string>;
  beats: Beat[];
}
