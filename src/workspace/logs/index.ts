import type { LLMLogEntry } from "wfp-format/logs";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";

export { buildErrorLogEntry, buildStepLogEntry } from "./helpers";
export type { BuildLogParams, BuildStepLogParams } from "./helpers";
export { formatLogMarkdown } from "./formatter";

/** Hard cap on retained LLM log entries per workspace (matches WorkspaceSession). */
export const MAX_LOGS = 50;

/**
 * Record one LLM log entry into the active workspace's document. Logs now live
 * INSIDE the encrypted .wfp (enc_logs section), not a separate table. No-op
 * when no workspace is open.
 */
export function writeLog(databaseId: string, entry: LLMLogEntry): void {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return;
  ws.appendLog(entry);
}

/** Fetch one log entry by id from the active workspace's document. */
export function getLog(databaseId: string, logId: string): LLMLogEntry | null {
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return null;
  return ws.getLog(logId);
}
