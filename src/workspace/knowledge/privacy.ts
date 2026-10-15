/**
 * Privacy map — single source of truth for the real→fake masking map.
 *
 * Replaces the old positional-token scheme (`<eN>` / `<aN>`) with realistic
 * faker-style stand-ins generated deterministically from each real value, so
 * the LLM sees semantically meaningful data instead of opaque tokens.
 *
 * Two packs back the map, both stored with scope "privacy-map" and never sent
 * to the LLM directly:
 *   - "privacy-map"            (manual)  — user-authored entity names
 *   - "privacy-map-automatic"  (auto)    — values discovered from data files
 *
 * Pack content is a JSON string of `[real, fake]` pairs. Legacy packs stored a
 * plain string[] of real values; those are decoded lazily and their fakes are
 * computed deterministically on read.
 */

import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { savePack, deletePack } from "./store";
import { generateFakeValue } from "./fakeGen";

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

function encodePairs(pairs: Pair[]): string {
  return JSON.stringify({ v: 1, entries: pairs });
}

function isPair(x: unknown): x is Pair {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === "string" &&
    typeof x[1] === "string"
  );
}

/** Decode a pack's content (new JSON pairs or legacy string[] / lines). */
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

function loadPackPairs(databaseId: string, name: string): Pair[] {
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
export function dropChainEntries(entries: PrivacyEntry[]): PrivacyEntry[] {
  const fakes = new Set<string>();
  for (const e of entries) fakes.add(e.fake);
  return entries.filter((e) => !fakes.has(e.real));
}

function loadEntries(databaseId: string): PrivacyEntry[] {
  const seen = new Map<string, PrivacyEntry>();
  for (const [name, source] of [
    [PRIVACY_MAP_NAME, "manual"],
    [AUTO_MASK_NAME, "automatic"],
    [LEGACY_AUTO_MASK_NAME, "automatic"],
  ] as Array<[string, PrivacyEntry["source"]]>) {
    for (const [real, fake] of loadPackPairs(databaseId, name)) {
      if (!real || !fake) continue;
      if (!seen.has(real)) seen.set(real, { real, fake, source });
    }
  }
  return dropChainEntries(Array.from(seen.values()));
}

/** All manual + automatic entries (real→fake), deduplicated by real value. */
export function listPrivacyEntries(databaseId: string): PrivacyEntry[] {
  return loadEntries(databaseId);
}

/**
 * Forward map (real → fake) sorted longest-real-first so longer entities are
 * masked before shorter substrings. Returns null when nothing is configured.
 */
export function loadPrivacyMap(databaseId: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const e of loadEntries(databaseId)) {
    if (e.real !== e.fake) map.set(e.real, e.fake);
  }
  if (map.size === 0) return null;
  return new Map(Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length));
}

/** Reverse map (fake → real) sorted longest-fake-first for unmasking. */
export function loadPrivacyReverseMap(databaseId: string): Map<string, string> | null {
  const map = new Map<string, string>();
  for (const e of loadEntries(databaseId)) {
    if (e.real !== e.fake) map.set(e.fake, e.real);
  }
  if (map.size === 0) return null;
  return new Map(Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length));
}

/**
 * Replace the manual privacy map with a new entity list, preserving the fakes
 * for any retained real values (so existing summaries stay consistent).
 * Empty list deletes the pack.
 */
export function setPrivacyEntities(databaseId: string, entities: string[]): void {
  const existing = loadPackPairs(databaseId, PRIVACY_MAP_NAME);
  const knownFake = new Map<string, string>(existing);
  const usedFakes = new Set<string>(existing.map(([, f]) => f));

  const pairs: Pair[] = [];
  for (const raw of entities) {
    const real = raw.trim();
    if (!real) continue;
    let fake = knownFake.get(real);
    if (!fake) {
      fake = resolveFake(real, usedFakes);
      usedFakes.add(fake);
    }
    pairs.push([real, fake]);
  }

  if (pairs.length === 0) {
    deletePack(databaseId, PRIVACY_MAP_NAME);
    return;
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  savePack(databaseId, {
    name: PRIVACY_MAP_NAME,
    scope: "privacy-map",
    tags: ["privacy"],
    content: encodePairs(pairs),
  });
}

/**
 * Append discovered values to the automated privacy map (append-only, deduped).
 * Existing values keep their fake; new values are appended. Returns the number
 * of values newly added.
 */
export function mergeAutoValues(databaseId: string, values: string[]): { added: number } {
  const existing = loadPackPairs(databaseId, AUTO_MASK_NAME);
  const seen = new Map<string, string>(existing);
  // Seed collision-tracking with every known stand-in (manual + auto + legacy)
  // so a fake discovered in tool results is never re-added as a new real value.
  const usedFakes = new Set<string>();
  for (const e of loadEntries(databaseId)) usedFakes.add(e.fake);
  const before = seen.size;

  for (const raw of values) {
    const real = raw.trim();
    if (!real || seen.has(real) || usedFakes.has(real)) continue;
    if (seen.size >= MAX_AUTO_MASK_TOTAL) break;
    const fake = resolveFake(real, usedFakes);
    seen.set(real, fake);
    usedFakes.add(fake);
  }

  const added = seen.size - before;
  if (added > 0) {
    savePack(databaseId, {
      name: AUTO_MASK_NAME,
      scope: "privacy-map",
      tags: ["privacy"],
      content: encodePairs(Array.from(seen.entries())),
    });
  }
  return { added };
}

/** Remove the automated mask entirely (user clears it from the privacy page). */
export function clearAutoMask(databaseId: string): void {
  const session = getSessionByDatabaseId(databaseId);
  session?.deleteKnowledgePack(AUTO_MASK_NAME);
  session?.deleteKnowledgePack(LEGACY_AUTO_MASK_NAME);
}
