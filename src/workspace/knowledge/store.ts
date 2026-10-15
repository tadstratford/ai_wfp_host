/**
 * Knowledge Pack Store — Area 5
 *
 * CRUD for user knowledge packs. Reads and writes the active WorkspaceSession's
 * `knowledge` array (post-M11e). System and operations packs are files on
 * disk — not in this store.
 */

import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { KnowledgePack as SpecKnowledgePack } from "wfp-format";

export interface KnowledgePack {
  name: string;
  scope: "chat" | "workflow" | "chat+workflow" | "privacy-map";
  tags: string[];
  content: string | string[];
  created_at: string;
  updated_at: string;
}

/**
 * Compatibility shim — knowledge state lives on the WorkspaceSession now;
 * there is no table to create. Kept as a no-op so callers don't break.
 */
export function ensureKnowledgeTable(_databaseId: string): void {
  // No-op post-M11e.
}

function fromSpec(p: SpecKnowledgePack): KnowledgePack {
  return {
    name: p.name,
    scope: p.scope,
    tags: Array.isArray(p.tags) ? p.tags : [],
    content: p.content,
    created_at: (p as any).created_at ?? "",
    updated_at: (p as any).updated_at ?? "",
  };
}

function toSpec(p: KnowledgePack): SpecKnowledgePack {
  return {
    name: p.name,
    scope: p.scope,
    tags: p.tags,
    content: p.content,
    // Host-only timestamps; preserved on save but not in the strict spec
    ...(p.created_at ? { created_at: p.created_at } : {}),
    ...(p.updated_at ? { updated_at: p.updated_at } : {}),
  } as any;
}

export function savePack(
  databaseId: string,
  pack: { name: string; scope?: string; tags?: string[]; content: string | string[] },
): void {
  const session = requireSessionByDatabaseId(databaseId);
  const now = new Date().toISOString();
  const existing = session.getKnowledgePack(pack.name);
  const scope = (pack.scope || "chat+workflow") as KnowledgePack["scope"];
  const tags = pack.tags ?? [];

  session.upsertKnowledgePack(
    toSpec({
      name: pack.name,
      scope,
      tags,
      content: pack.content,
      created_at: (existing as any)?.created_at ?? now,
      updated_at: now,
    }),
  );
}

export function getPack(databaseId: string, name: string): KnowledgePack | null {
  const session = requireSessionByDatabaseId(databaseId);
  const p = session.getKnowledgePack(name);
  return p ? fromSpec(p) : null;
}

export function listPacks(
  databaseId: string,
  filter?: { scope?: string },
): KnowledgePack[] {
  const session = requireSessionByDatabaseId(databaseId);
  let packs = session.getKnowledgePacks().map(fromSpec);

  if (filter?.scope === "privacy-map") {
    packs = packs.filter((p) => p.scope === "privacy-map");
  } else if (filter?.scope) {
    packs = packs.filter(
      (p) => (p.scope === filter.scope || p.scope === "chat+workflow") && p.scope !== "privacy-map",
    );
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  return packs;
}

export function deletePack(databaseId: string, name: string): boolean {
  const session = requireSessionByDatabaseId(databaseId);
  return session.deleteKnowledgePack(name);
}
