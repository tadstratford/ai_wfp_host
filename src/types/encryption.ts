export interface EncryptionEnvelope {
  $wfp_enc: "1";
  alg: "AES-GCM-256";
  kdf: "PBKDF2-SHA256" | "Argon2id";
  iter?: number;
  mem?: number;
  salt: string;
  iv: string;
  aad?: string;
  ct: string;
  hint?: string;
}

export function isEncryptionEnvelope(v: unknown): v is EncryptionEnvelope {
  return (
    typeof v === "object" &&
    v !== null &&
    "$wfp_enc" in (v as Record<string, unknown>)
  );
}
