// In-memory rate limiter for the AUTH=password login path.
//
// Keyed by email + client IP, one-hour sliding window. No external dependency
// (works self-hosted without Supabase). Mirrors the style of
// src/shared/llm/rateLimiter.ts but is scoped to login attempts.

const WINDOW_MS = 60 * 60 * 1000;

function maxAttempts(): number {
  const n = Number(process.env.AUTH_LOGIN_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

interface Entry {
  count: number;
  windowStart: number;
}

const attempts = new Map<string, Entry>();

function entryFor(email: string, ip: string): Entry {
  const key = `${email.toLowerCase()}|${ip}`;
  const existing = attempts.get(key);
  if (!existing || Date.now() - existing.windowStart > WINDOW_MS) {
    const fresh = { count: 0, windowStart: Date.now() };
    attempts.set(key, fresh);
    return fresh;
  }
  return existing;
}

export function checkLoginRateLimit(
  email: string,
  ip: string,
): { allowed: boolean; message?: string } {
  const entry = entryFor(email, ip);
  if (entry.count >= maxAttempts()) {
    return {
      allowed: false,
      message: "Too many login attempts. Please try again later.",
    };
  }
  return { allowed: true };
}

export function recordLoginFailure(email: string, ip: string): void {
  entryFor(email, ip).count++;
}
