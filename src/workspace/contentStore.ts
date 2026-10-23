// contentStore — content-addressed storage of historical node versions for the
// "Time Machine". The provenance ledger records `newContentHash` (SHA-256 of
// the node's plaintext JSON); this store persists the actual payload keyed by
// that hash so past values can be reconstructed for diffs and "reopen as of X".
//
// Content is encrypted with the workspace secret when private (plaintext when
// shared, matching the main workspaces sections). Writes are best-effort: if
// a write fails the ledger still carries the hash — only that historical value
// becomes un-reconstructable, never the current document.

import { EDITION } from "@shared/edition";
import * as db from "../server/admin/supabase";
import { decryptSection, encryptSection } from "./crypto";

const TABLE = "workspace_content";

export async function storeContent(
  workspaceId: string,
  hash: string,
  plaintext: string,
  secret: string | null,
): Promise<void> {
  if (EDITION === "local") return;
  const enc = secret ? encryptSection(plaintext, secret) : plaintext;
  const result = await db.upsert(TABLE, {
    workspace_id: workspaceId,
    content_hash: hash,
    enc_content: enc,
  });
  if (result.error) {
    console.error(`[contentStore] upsert failed for ${workspaceId}/${hash}: ${result.error}`);
  }
}

/** Return the decrypted historical payload, or null if not stored (or the
 *  secret no longer matches, e.g. after a secret rotation). */
export async function loadContent(
  workspaceId: string,
  hash: string,
  secret: string | null,
): Promise<string | null> {
  if (EDITION === "local") return null;
  const result = await db.selectOne<{ enc_content: string }>(
    TABLE,
    { workspace_id: workspaceId, content_hash: hash },
    "enc_content",
  );
  if (result.error || !result.data) return null;
  const enc = result.data.enc_content;
  if (!secret) return enc;
  try {
    return decryptSection(enc, secret);
  } catch {
    return null;
  }
}
