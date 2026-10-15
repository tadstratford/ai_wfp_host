import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "path";
import { dataRoot } from "../dataRoot";

/**
 * Structured Error Logger
 *
 * Writes structured JSON error entries to logs/errors.jsonl (one per line).
 * Designed for post-hoc debugging — grep-friendly, no external dependencies.
 */

const LOG_DIR = join(dataRoot(), "logs");
const LOG_FILE = join(LOG_DIR, "errors.jsonl");

function ensureLogDir(): void {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}

export interface ErrorLogEntry {
    ts: string;
    level: "error" | "warn";
    source: string;
    userId?: string;
    error: string;
    stack?: string;
    context?: Record<string, any>;
}

/**
 * Log a structured error to logs/errors.jsonl
 */
export function logError(
    source: string,
    error: unknown,
    extra?: {
        userId?: string;
        level?: "error" | "warn";
        context?: Record<string, any>;
    }
): void {
    try {
        ensureLogDir();

        const err = error instanceof Error ? error : new Error(String(error));
        const entry: ErrorLogEntry = {
            ts: new Date().toISOString(),
            level: extra?.level || "error",
            source,
            userId: extra?.userId,
            error: err.message,
            stack: err.stack,
            context: extra?.context,
        };

        appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    } catch {
        // Never let logging break the app
        console.error("[ErrorLogger] Failed to write log entry");
    }
}

/**
 * Log a warning (less severe than error)
 */
export function logWarn(
    source: string,
    message: string,
    extra?: { userId?: string; context?: Record<string, any> }
): void {
    logError(source, new Error(message), { ...extra, level: "warn" });
}
