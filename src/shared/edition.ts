// edition — selects where the workspace data lives.
//
//   "hosted" (default) — SaaS: workspaces stored in Supabase; server keys.
//   "enterprise"        — multi-user self-host: Postgres, admin fronts keys.
//   "local"             — single-user desktop: local `.wfp` file, own keys.
//
// "standard" is accepted as an alias for "hosted". Selected at runtime via the
// EDITION environment variable. EDITION presets the billing/key/data knobs
// below (each can still be overridden by its own env var).

export type Edition = "hosted" | "enterprise" | "local";

function resolveEdition(): Edition {
  const raw = (process.env.EDITION || "hosted").toLowerCase();
  if (raw === "enterprise") return "enterprise";
  if (raw === "local") return "local";
  if (raw === "hosted" || raw === "standard") return "hosted";
  console.warn(
    `[edition] Unknown EDITION "${raw}". Expected "hosted", "enterprise", or "local". Treating as "hosted".`,
  );
  return "hosted";
}

export const EDITION: Edition = resolveEdition();

// AUTH_MODE — how users sign in. Preset by EDITION, overridable via the AUTH
// env var:
//   none     — no login (local single-user; the existing EDITION=local path)
//   password — email + password (enterprise self-host; no email/Google needed)
//   google   — Google OAuth + magic link (hosted)
export type AuthMode = "none" | "password" | "google";

function resolveAuthMode(): AuthMode {
  const raw = (process.env.AUTH ?? "").trim().toLowerCase();
  if (raw === "") {
    if (EDITION === "local") return "none";
    if (EDITION === "enterprise") return "password";
    return "google";
  }
  if (raw === "none" || raw === "password" || raw === "google") return raw;
  throw new Error(
    `Unknown AUTH "${raw}". Expected "none", "password", or "google".`,
  );
}

export const AUTH_MODE: AuthMode = resolveAuthMode();

/** Default billing mode when BILLING_MODE is unset, derived from EDITION. */
export function defaultBillingMode(): "credits" | "admin_pays" | "none" {
  if (EDITION === "enterprise") return "admin_pays";
  if (EDITION === "local") return "none";
  return "credits";
}

/** Default key store backend when KEYSTORE is unset, derived from EDITION. */
export function defaultKeyStore(): "postgres" | "file" {
  return EDITION === "local" ? "file" : "postgres";
}

/** Whether the default data root is the process working directory (hosted). */
export function dataRootIsCwd(): boolean {
  return EDITION === "hosted";
}
