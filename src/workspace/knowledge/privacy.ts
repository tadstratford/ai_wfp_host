/**
 * Privacy mask — single source of truth for the real→fake masking map.
 *
 * Stored in the top-level `.wfp` `privacy_mask` node (a `PrivacyMask` with
 * structured entries carrying real/fake/source/addedAt/addedBy). Legacy `.wfp`
 * files stored the map as `privacy-map` knowledge packs; those are read as a
 * fallback and migrated to the node on the next write.
 *
 * Two sources back the map, both kept inside the node and never sent to the
 * LLM directly:
 *   - manual      — user-authored entity names
 *   - automatic   — values discovered from data files
 */

import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { generateFakeValue } from "./fakeGen";
import type { PrivacyMaskEntry } from "wfp-format/privacy";

export const PRIVACY_MAP_NAME = "privacy-map";
export const AUTO_MASK_NAME = "privacy-map-automatic";
/** Former name — kept so stale packs are recognized/skipped after the rename. */
export const LEGACY_AUTO_MASK_NAME = "privacy-map-automate";

/** Safety cap on total masked entries (guard against pathological free-text). */
export const MAX_AUTO_MASK_TOTAL = 200000;

export interface PrivacyEntry {
  real: string;
  fake: string;
  source: "manual" | "automatic";
}

type Pair = [string, string];

// ── Legacy pack fallback (decode old `[real, fake]` pack content) ──────────

function isPair(x: unknown): x is Pair {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === "string" &&
    typeof x[1] === "string"
  );
}

function decodePairs(content: unknown): Pair[] {
  if (!content) return [];
  if (Array.isArray(content)) {
    return content
      .map((v) => String(v).trim())
      .filter(Boolean)
      .filter((v) => !v.startsWith("#"))
      .map((real): Pair => [real, generateFakeValue(real)]);
  }
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter(isPair);
        if (parsed && Array.isArray(parsed.entries)) return parsed.entries.filter(isPair);
      } catch {
        /* fall through to line-based legacy */
      }
    }
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("#"))
      .map((real): Pair => [real, generateFakeValue(real)]);
  }
  return [];
}

function loadLegacyPackPairs(databaseId: string, name: string): Pair[] {
  const session = getSessionByDatabaseId(databaseId);
  const pack = session?.getKnowledgePack(name);
  if (!pack) return [];
  return decodePairs((pack as { content?: unknown }).content);
}

/** Collision-safe fake: retry with a salt until unique among already-used fakes. */
function resolveFake(real: string, usedFakes: Set<string>): string {
  let fake = generateFakeValue(real);
  // Values that can't be given a distinct stand-in (bare numbers/IDs map to
  // themselves) are no-ops — return immediately so the collision loop can't spin.
  if (fake === real) return real;
  let salt = 0;
  while (usedFakes.has(fake)) {
    salt++;
    fake = generateFakeValue(real, salt);
    if (salt > 1000) break; // defensive cap — never hang the server
  }
  return fake;
}

/**
 * Drop chain entries — any entry whose "real" value is also some other entry's
 * stand-in. These arise when a fake gets re-discovered and re-masked (e.g.
 * "Franklin Fund LP" → "South Maple LP", then "South Maple LP" → "Pine Harbor
 * LP"). Keeping them would double-mask data and garble the reverse mapping.
 */
export function dropChainEntries<T extends { real: string; fake: string }>(
  entries: T[],
): T[] {
  const fakes = new Set<string>();
  for (const e of entries) fakes.add(e.fake);
  return entries.filter((e) => !fakes.has(e.real));
}

// ── Node access ────────────────────────────────────────────────────────────

function loadNodeEntries(databaseId: string): PrivacyMaskEntry[] {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return [];
  return session.getPrivacyMask().entries ?? [];
}

function saveNodeEntries(databaseId: string, entries: PrivacyMaskEntry[]): void {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return;
  session.setPrivacyMask({ entries });
}

/**
 * All entries (manual + automatic) as structured `PrivacyMaskEntry[]`, deduped
 * by real value (first-seen wins). Reads the `privacy_mask` node; falls back
 * to legacy `privacy-map` knowledge packs for old `.wfp` files.
 */
function loadMaskEntries(databaseId: string): PrivacyMaskEntry[] {
  const nodeEntries = loadNodeEntries(databaseId);
  if (nodeEntries.length > 0) {
    const seen = new Map<string, PrivacyMaskEntry>();
    for (const e of nodeEntries) {
      if (!e.real || !e.fake || seen.has(e.real)) continue;
      seen.set(e.real, e);
    }
    return dropChainEntries(Array.from(seen.values()));
  }

  // Legacy fallback — migrate old pack entries into node-form.
  const seen = new Map<string, PrivacyMaskEntry>();
  const now = new Date().toISOString();
  for (const [name, source] of [
    [PRIVACY_MAP_NAME, "manual"],
    [AUTO_MASK_NAME, "automatic"],
    [LEGACY_AUTO_MASK_NAME, "automatic"],
  ] as Array<[string, PrivacyMaskEntry["source"]]>) {
    for (const [real, fake] of loadLegacyPackPairs(databaseId, name)) {
      if (!real || !fake || seen.has(real)) continue;
      seen.set(real, { real, fake, source, addedAt: now });
    }
  }
  return dropChainEntries(Array.from(seen.values()));
}

/** All manual + automatic entries (real→fake), deduplicated by real value. */
export function listPrivacyEntries(databaseId: string): PrivacyEntry[] {
  return loadMaskEntries(databaseId).map(({ real, fake, source }) => ({
    real,
    fake,
    source,
  }));
}

/**
 * Forward map (real → fake) sorted longest-real-first so longer entities are
 * masked before shorter substrings. Returns null when nothing is configured.
 */
export function loadPrivacyMap(databaseId: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const e of listPrivacyEntries(databaseId)) {
    if (e.real !== e.fake) map.set(e.real, e.fake);
  }
  if (map.size === 0) return null;
  return new Map(Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length));
}

/** Reverse map (fake → real) sorted longest-fake-first for unmasking. */
export function loadPrivacyReverseMap(databaseId: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const e of listPrivacyEntries(databaseId)) {
    if (e.real !== e.fake) map.set(e.fake, e.real);
  }
  if (map.size === 0) return null;
  return new Map(Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length));
}

/**
 * Replace the manual privacy map with a new entity list, preserving the fakes
 * for any retained real values (so existing summaries stay consistent) and the
 * existing automatic entries. Empty list leaves only the automatic entries.
 */
export function setPrivacyEntities(databaseId: string, entities: string[]): void {
  const existing = loadMaskEntries(databaseId);
  const knownFake = new Map<string, string>();
  const usedFakes = new Set<string>();
  for (const e of existing) {
    usedFakes.add(e.fake);
    if (e.source === "manual") knownFake.set(e.real, e.fake);
  }

  const now = new Date().toISOString();
  const manual: PrivacyMaskEntry[] = [];
  for (const raw of entities) {
    const real = raw.trim();
    if (!real) continue;
    let fake = knownFake.get(real);
    if (!fake) {
      fake = resolveFake(real, usedFakes);
      usedFakes.add(fake);
    }
    manual.push({ real, fake, source: "manual", addedAt: now });
  }
  manual.sort((a, b) => b.real.length - a.real.length);

  const auto = existing.filter((e) => e.source === "automatic");
  saveNodeEntries(databaseId, [...manual, ...auto]);
}

/**
 * Append discovered values to the automated privacy map (append-only, deduped).
 * Existing values keep their fake; new values are appended. Returns the number
 * of values newly added.
 */
export function mergeAutoValues(databaseId: string, values: string[]): { added: number } {
  const existing = loadMaskEntries(databaseId);
  const seen = new Map<string, PrivacyMaskEntry>();
  const usedFakes = new Set<string>();
  for (const e of existing) {
    usedFakes.add(e.fake);
    if (e.source === "automatic") seen.set(e.real, e);
  }
  const manual = existing.filter((e) => e.source === "manual");
  const before = seen.size;

  const now = new Date().toISOString();
  for (const raw of values) {
    const real = raw.trim();
    if (!real || seen.has(real) || usedFakes.has(real)) continue;
    if (seen.size >= MAX_AUTO_MASK_TOTAL) break;
    const fake = resolveFake(real, usedFakes);
    seen.set(real, { real, fake, source: "automatic", addedAt: now });
    usedFakes.add(fake);
  }

  const added = seen.size - before;
  if (added > 0) {
    saveNodeEntries(databaseId, [...manual, ...Array.from(seen.values())]);
  }
  return { added };
}

/** Remove the automated mask entirely (user clears it from the privacy page). */
export function clearAutoMask(databaseId: string): void {
  const existing = loadMaskEntries(databaseId);
  const manual = existing.filter((e) => e.source === "manual");
  saveNodeEntries(databaseId, manual);
}
