// Content hashing for the "Time Machine" provenance ledger.
//
// A SHA-256 fingerprint of a node's JSON value. Used to (a) make the ledger
// tamper-evident (each event chains to the previous via `prevHash`) and (b)
// reference content-addressed payload versions. Hash plaintext (before
// encryption), never ciphertext — ciphertext changes every write.

import { createHash } from "node:crypto";

/** SHA-256 (hex) of a value's canonical JSON. */
export function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
