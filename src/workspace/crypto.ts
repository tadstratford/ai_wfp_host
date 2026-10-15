import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const ALGO = "aes-256-gcm";
const ITERATIONS = 200_000;
const DIGEST = "sha256";
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;

interface WfpEncryptedEnvelope {
  wfp_encrypted: true;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function encryptWorkspace(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, DIGEST);

  const compressed = gzipSync(Buffer.from(plaintext, "utf8"));

  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: WfpEncryptedEnvelope = {
    wfp_encrypted: true,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("base64"),
  };

  return JSON.stringify(envelope);
}

export function decryptWorkspace(envelopeJson: string, passphrase: string): string {
  let envelope: WfpEncryptedEnvelope;
  try {
    envelope = JSON.parse(envelopeJson) as WfpEncryptedEnvelope;
  } catch {
    throw new Error("Invalid encrypted file format.");
  }

  const salt = Buffer.from(envelope.salt, "hex");
  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const data = Buffer.from(envelope.data, "base64");

  const key = pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, DIGEST);

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const decompressed = gunzipSync(decrypted);
    return Buffer.from(decompressed).toString("utf8");
  } catch {
    throw new Error("Incorrect passphrase or corrupted file.");
  }
}

export function isEncryptedEnvelope(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed.wfp_encrypted === true;
  } catch {
    return false;
  }
}

// ── Per-section encryption ──────────────────────────────────────────────────
// One encrypted column per WFP section. Each section is its own AES-256-GCM
// envelope (fresh salt + IV) derived from the same workspace secret, so a save
// can re-encrypt only the sections that changed. Sections are gzip'd like the
// whole-file path.

interface WfpSectionEnvelope {
  wfp_section_enc: true;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

export function encryptSection(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, DIGEST);

  const compressed = gzipSync(Buffer.from(plaintext, "utf8"));

  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: WfpSectionEnvelope = {
    wfp_section_enc: true,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("base64"),
  };

  return JSON.stringify(envelope);
}

export function decryptSection(envelopeJson: string, passphrase: string): string {
  let envelope: WfpSectionEnvelope;
  try {
    envelope = JSON.parse(envelopeJson) as WfpSectionEnvelope;
  } catch {
    throw new Error("Invalid encrypted section format.");
  }

  const salt = Buffer.from(envelope.salt, "hex");
  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const data = Buffer.from(envelope.data, "base64");

  const key = pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, DIGEST);

  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const decompressed = gunzipSync(decrypted);
    return decompressed.toString("utf8");
  } catch {
    throw new Error("Incorrect passphrase or corrupted section.");
  }
}

export function isEncryptedSectionEnvelope(content: string | null | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return parsed.wfp_section_enc === true;
  } catch {
    return false;
  }
}
