/**
 * Site Visits Tracker — Buffered writes to Supabase
 *
 * Lightweight page view logging for public pages.
 * No user IDs, no referrers — just page + timestamp.
 */

import { insert } from "./supabase";

interface BufferedVisit {
  id: string;
  page: string;
  host: string;
  created_at: string;
}

const buffer: BufferedVisit[] = [];
const FLUSH_SIZE = 20;
const FLUSH_INTERVAL_MS = 60_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0) return;
  const entries = buffer.splice(0);
  try {
    const { error } = await insert("site_visits", entries);
    if (error) {
      console.error("[SiteVisits] Flush error:", error);
    }
  } catch (err) {
    console.error("[SiteVisits] Flush error:", err);
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushBuffer().catch((err) =>
      console.error("[SiteVisits] Timer flush error:", err),
    );
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

process.on("beforeExit", () => {
  flushBuffer();
});

/**
 * Log a page view. Call from middleware — returns immediately (non-blocking).
 */
export function logPageView(page: string, host: string): void {
  //const page = normalizePage(requestPath);

  //  if (!page) return;

  buffer.push({
    id: crypto.randomUUID(),
    page,
    host,
    created_at: new Date().toISOString(),
  });

  ensureFlushTimer();

  if (buffer.length >= FLUSH_SIZE) {
    flushBuffer().catch((err) =>
      console.error("[SiteVisits] Size flush error:", err),
    );
  }
}
