import { Context } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * Simple SSE handler that sends notification events to trigger HTMX refreshes.
 *
 * GLOBAL notification stream — connected on the app body, survives HTMX swaps.
 *
 * Pattern:
 * 1. Layout body connects: <body hx-ext="sse" sse-connect="/app/api/sse">
 * 2. HTMX elements listen: hx-trigger="load, sse:new_message from:body"
 * 3. When SSE sends an event, HTMX makes an HTTP request to fetch fresh data.
 *
 * Events:
 * - new_message: triggers message-list refresh
 * - workflow_complete: signals a workflow/build has finished
 * - todo_update: triggers right-panel todo refresh
 *
 * ── Fan-out, not a shared queue ──────────────────────────────────────────────
 * Every connected client gets its OWN pending queue, registered in `subscribers`.
 * `notifyClients` writes each event to EVERY subscriber. Previously a single
 * module-level queue was drained with `shift()`, so each event was delivered to
 * exactly one stream — whichever polled first. With more than one live stream
 * (multiple tabs, a standalone /sessions page beside the /app shell, or zombie
 * streams left behind by `HX-Redirect` navigations) events were "stolen" by a
 * stream that wasn't driving the user's current view, so async results (an
 * answer, a build result, a todo update) silently never appeared. Per-client
 * queues + prompt disconnect cleanup eliminate that theft.
 *
 * Note: hono's stream `write()` swallows errors, so a dead stream never throws.
 * The reliable disconnect signal is `onAbort` (fired when the client closes the
 * EventSource or navigates away); we use it to drop the subscriber immediately.
 */

interface Subscriber {
  id: number;
  /** This client's private queue. Only this client's loop drains it. */
  queue: { sessionId: string; event: string; data?: string }[];
}

const subscribers = new Set<Subscriber>();
let nextClientId = 1;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Explicit reconnect interval so the browser's EventSource reconnects
// predictably after a dropped stream instead of relying on its default.
const SSE_RETRY_MS = envInt("SSE_RETRY_MS", 3000);

/**
 * Broadcast a notification to every connected client.
 * Signature is unchanged from the old shared-queue version.
 */
export function notifyClients(sessionId: string, event: string, data?: string) {
  console.log(
    `[SSE] Broadcasting ${event} for session ${sessionId} to ${subscribers.size} client(s)`,
  );
  for (const sub of subscribers) {
    sub.queue.push({ sessionId, event, data });
  }
}

/**
 * SSE endpoint handler — one per connected client.
 */
export const handleSimpleSSE = async (c: Context) => {
  const sub: Subscriber = { id: nextClientId++, queue: [] };
  subscribers.add(sub);
  console.log(`[SSE] Client #${sub.id} connected (${subscribers.size} total)`);

  return streamSSE(c, async (stream) => {
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      subscribers.delete(sub);
      console.log(`[SSE] Client #${sub.id} disconnected (${subscribers.size} total)`);
    };

    // Fires when the client closes the EventSource or navigates away. This is
    // the only reliable disconnect signal (write() never throws), so it's what
    // stops a navigated-away page's loop from lingering.
    stream.onAbort(cleanup);

    // Initial event. The browser's EventSource auto-reconnects if the stream
    // drops. Emit an explicit `retry:` line so it reconnects on a known
    // interval rather than the browser default.
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ time: new Date().toISOString() }),
    });
    await stream.write(`retry: ${SSE_RETRY_MS}\n\n`);

    let pollCount = 0;
    const maxPolls = 14400; // 2 hours at 500ms — survives a long work session

    try {
      while (active && pollCount < maxPolls) {
        // Drain THIS client's queue (no competition with other clients).
        while (active && sub.queue.length > 0) {
          const n = sub.queue.shift()!;
          await stream.writeSSE({
            event: n.event,
            data: JSON.stringify({
              sessionId: n.sessionId,
              ...(n.data ? { data: n.data } : {}),
            }),
          });
        }

        // Heartbeat every ~30s to keep the connection alive.
        if (pollCount % 60 === 0) {
          await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
        }

        await stream.sleep(500);
        pollCount++;
      }
    } catch (err) {
      console.error(`[SSE] Client #${sub.id} error:`, err);
    } finally {
      cleanup();
    }
  });
};
