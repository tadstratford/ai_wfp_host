/**
 * User Activity Tracker — Buffered Writes to Supabase
 *
 * Logs user actions (login, slash commands, workspace ops) to user_activity table.
 * Follows the same buffered-write pattern as usageTracker.ts.
 */

import { insert } from "@backend/core/admin/supabase";

interface BufferedActivity {
    id: string;
    user_id: string | null;
    user_email: string;
    action: string;
    detail: string | null;
    created_at: string;
}

const buffer: BufferedActivity[] = [];
const FLUSH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const entries = buffer.splice(0);
    try {
        const { error } = await insert("user_activity", entries);
        if (error) {
            console.error("[ActivityTracker] Failed to flush to Supabase:", error);
        }
    } catch (err) {
        console.error("[ActivityTracker] Flush error:", err);
    }
}

function ensureFlushTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
        flushBuffer().catch(err => console.error("[ActivityTracker] Timer flush error:", err));
    }, FLUSH_INTERVAL_MS);
    if (flushTimer.unref) flushTimer.unref();
}

process.on("beforeExit", () => { flushBuffer(); });

/**
 * Log a user activity event.
 *
 * @param userEmail - User's email address
 * @param action - Action type (e.g., "login", "slash_build", "workspace_export")
 * @param detail - Optional detail string (e.g., workflow name, command text)
 * @param userId - Optional user_id for FK reference
 */
export function logActivity(
    userEmail: string,
    action: string,
    detail?: string,
    userId?: string
): void {
    try {
        buffer.push({
            id: crypto.randomUUID(),
            user_id: userId ?? null,
            user_email: userEmail,
            action,
            detail: detail ?? null,
            created_at: new Date().toISOString(),
        });

        ensureFlushTimer();

        if (buffer.length >= FLUSH_SIZE) {
            flushBuffer().catch(err => console.error("[ActivityTracker] Size flush error:", err));
        }
    } catch (err) {
        console.error("[ActivityTracker] Failed to buffer activity:", err);
    }
}
