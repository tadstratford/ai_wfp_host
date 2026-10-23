// Privacy mask — the top-level `privacy_mask` node. The single source of truth
// for the real→fake confidentiality map. Structured entries (vs. the legacy
// `privacy-map` knowledge packs) so each mapping carries its own provenance.

export type PrivacySource = "manual" | "automatic";

export interface PrivacyMaskEntry {
  /** The real, sensitive value/name. */
  real: string;
  /** The deterministic stand-in the LLM sees instead. */
  fake: string;
  /** "manual" (user-authored) or "automatic" (discovered from data files). */
  source: PrivacySource;
  /** When the entry was added. */
  addedAt: string;
  /** Who/what added it (user id or synthetic agent id). */
  addedBy?: string;
}

export interface PrivacyMask {
  entries: PrivacyMaskEntry[];
}
