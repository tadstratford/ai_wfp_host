/**
 * Knowledge Pack Loader — User packs only.
 *
 * System and operations packs are now loaded via chat/vers_1/prompts/loader.ts.
 * This file handles only user-created knowledge packs from the database.
 */

import { listPacks, getPack, type KnowledgePack } from "./store";

/**
 * Load all user knowledge packs matching a scope filter.
 */
export function loadUserPacks(
  databaseId: string,
  filter?: { scope?: "chat" | "workflow" },
): KnowledgePack[] {
  return listPacks(databaseId, filter);
}

/**
 * Load a single user knowledge pack by name. Returns markdown content or null.
 * Privacy-map packs store a string[] and are not returned here (see loadPrivacyMap).
 */
export function loadUserPack(databaseId: string, name: string): string | null {
  const pack = getPack(databaseId, name);
  return typeof pack?.content === "string" ? pack.content : null;
}


