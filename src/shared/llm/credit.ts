import { userManager } from "@backend/core/admin/userManager";

/**
 * Beta-credit enforcement. Server-key users (the operator is footing the bill)
 * are hard-blocked once their granted credit is exhausted. BYO-key users are
 * never gated — their cost is on their own key.
 */

export class OutOfCreditError extends Error {
  constructor() {
    super(
      "You're out of beta credit. Enter a beta code on your account screen to continue.",
    );
    this.name = "OutOfCreditError";
  }
}

export interface CreditStatus {
  balance: number;
  used: number;
  remaining: number;
}

/** Per-call upcharge fraction for server-key usage (e.g. 0.30 = +30%). */
export function creditMargin(): number {
  const n = Number(process.env.CREDIT_MARGIN ?? "0");
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Raw token cost → amount charged against credit (cost × (1 + margin)). */
export function billedCost(costUsd: number): number {
  return costUsd * (1 + creditMargin());
}

export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  const { balance, used: rawUsed } = await userManager.getCreditStatus(userId);
  const used = rawUsed * (1 + creditMargin());
  return { balance, used, remaining: Math.max(0, balance - used) };
}

/**
 * Throws OutOfCreditError if the user has no usable credit. No-op when the
 * guard is disabled (DISABLE_CREDIT_GUARD=true) — operator escape hatch.
 */
export async function enforceCredit(userId: string): Promise<void> {
  if (process.env.DISABLE_CREDIT_GUARD === "true") return;

  const { balance, used } = await getCreditStatus(userId);
  if (balance <= 0 || used >= balance) {
    throw new OutOfCreditError();
  }
}
