/**
 * KeyStore seam — where a user's named secrets (LLM/Jev API keys) are stored.
 *
 *   postgres (default) — admin_users.encrypted_secrets (hosted + multi-user)
 *   file                — local encrypted file (single-user self-host)
 *
 * The file backend stores the SAME AES-GCM-encrypted blob (APP_SECRET) that
 * postgres does, so the on-disk format is identical and both are encrypted at
 * rest. See ARCHITECTURE-DECISIONS.md §6.
 */

import { encrypt, decrypt } from "@backend/core/crypto";
import { selectOne, update } from "./supabase";
import { dataRoot } from "@shared/dataRoot";
import { defaultKeyStore } from "@shared/edition";
import * as fs from "fs";
import * as path from "path";

export interface SecretEntry {
  value: string;
}

export type SecretsBlob = Record<string, SecretEntry>;

export function keyStoreBackend(): "postgres" | "file" {
  const raw = (process.env.KEYSTORE ?? "").trim().toLowerCase();
  if (raw === "file") return "file";
  if (raw === "postgres") return "postgres";
  return defaultKeyStore();
}

function blobFilePath(userId: string): string {
  const instance = (process.env.INSTANCE || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(dataRoot(), "data", instance, "keystore");
  return path.join(dir, `${userId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

/** Decrypt and parse an encrypted_secrets blob. Normalizes legacy plain-string
 *  values to the `{ value }` shape. */
export function parseSecretsBlob(encrypted: string | null | undefined): SecretsBlob {
  if (!encrypted) return {};
  try {
    const decrypted = decrypt(encrypted);
    if (!decrypted) return {};
    const raw = JSON.parse(decrypted);
    const result: SecretsBlob = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") {
        result[k] = { value: v };
      } else if (v && typeof v === "object" && "value" in (v as any)) {
        result[k] = v as SecretEntry;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Encrypt a SecretsBlob for storage. Returns null when empty. */
export function encryptSecretsBlob(secrets: SecretsBlob): string | null {
  if (Object.keys(secrets).length === 0) return null;
  return encrypt(JSON.stringify(secrets));
}

export async function readSecretsBlob(userId: string): Promise<SecretsBlob> {
  if (keyStoreBackend() === "file") {
    try {
      const raw = fs.readFileSync(blobFilePath(userId), "utf-8");
      return parseSecretsBlob(raw);
    } catch {
      return {};
    }
  }
  const { data, error } = await selectOne("admin_users", { user_id: userId }, "encrypted_secrets");
  if (error) return {};
  return parseSecretsBlob(data?.encrypted_secrets);
}

export async function writeSecretsBlob(userId: string, blob: SecretsBlob): Promise<void> {
  const encrypted = encryptSecretsBlob(blob);
  if (keyStoreBackend() === "file") {
    const file = blobFilePath(userId);
    if (encrypted == null) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, encrypted, "utf-8");
    }
    return;
  }
  const { error } = await update("admin_users", { user_id: userId }, { encrypted_secrets: encrypted });
  if (error) console.error("[keyStore] writeSecretsBlob:", error);
}
