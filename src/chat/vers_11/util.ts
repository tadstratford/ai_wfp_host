/**
 * Small shared helpers for the vers_11 orchestrator harness.
 */

/** True when a free-text reply is an affirmative approval of a paused gate. */
export function isApproval(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[.!?]+$/, "");
  return ["approve", "approved", "confirm", "confirmed", "yes", "yep", "yeah", "go ahead", "proceed", "do it", "post it"].includes(t);
}

/** Race a promise against a timeout so a hung model/tool call surfaces as an
 *  error instead of silently stalling the turn. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
