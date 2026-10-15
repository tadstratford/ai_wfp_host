/**
 * Billing seam — selects how server-key LLM/Classifier usage is billed.
 *
 * Three modes, chosen by `BILLING_MODE`:
 *   - `credits`     — hosted SaaS. Server-key users are hard-gated by their
 *                    credit balance and rate-limited; usage is metered.
 *   - `admin_pays`  — multi-user self-host. The admin fronts the key for all
 *                    users; no per-user credit gate or rate limit.
 *   - `none`        — single-user self-host (BYO key). No billing, no gate.
 *
 * `byo` is accepted as an alias for `none`. When `BILLING_MODE` is unset, the
 * mode is derived from `EDITION` (hosted→credits, enterprise→admin_pays,
 * local→none) via `defaultBillingMode()`.
 *
 * The mode only matters when `usingServerKey` is true (the admin pays). Users
 * who bring their own key are never gated regardless of mode — their cost is on
 * their own key.
 */

import { defaultBillingMode } from "../edition";

export type BillingMode = "credits" | "admin_pays" | "none";

export function billingMode(): BillingMode {
  const v = (process.env.BILLING_MODE ?? "").trim().toLowerCase();
  if (v === "credits") return "credits";
  if (v === "admin_pays") return "admin_pays";
  if (v === "none" || v === "byo") return "none";
  return defaultBillingMode();
}

/** Whether server-key users are hard-blocked when their credit is exhausted. */
export function shouldEnforceCredit(): boolean {
  return billingMode() === "credits";
}

/** Whether server-key users are subject to the per-hour call cap. */
export function shouldRateLimit(): boolean {
  return billingMode() === "credits";
}

/** Whether usage should be metered at all (off in pure single-user BYO). */
export function shouldMeterUsage(): boolean {
  return billingMode() !== "none";
}
