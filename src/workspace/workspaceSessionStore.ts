// workspaceSessionStore — per-user registry of open WorkspaceSessions.
//
// At most one open session per user (workspace switching closes the previous
// one). Idle sessions are swept after `IDLE_TIMEOUT_MS`. State lives in
// process RAM only — it is gone on logout, workspace switch, idle timeout,
// or process restart. Never persisted.

import type { WfpFile } from "wfp-format";
import { WorkspaceSession } from "./WorkspaceSession";

const IDLE_TIMEOUT_MS = envInt("IDLE_TIMEOUT_MS", 15 * 60 * 1000);
const SWEEP_INTERVAL_MS = envInt("SWEEP_INTERVAL_MS", 60 * 1000);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const sessionsByUser = new Map<string, WorkspaceSession>();
const userIdByDatabaseId = new Map<string, string>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function indexDatabaseId(session: WorkspaceSession): void {
  const dbId = session.databaseId;
  if (dbId) userIdByDatabaseId.set(dbId, session.userId);
}

function unindexDatabaseId(session: WorkspaceSession): void {
  const dbId = session.databaseId;
  if (dbId && userIdByDatabaseId.get(dbId) === session.userId) {
    userIdByDatabaseId.delete(dbId);
  }
}

function ensureSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Don't keep the process alive solely for the sweeper.
  if (typeof (sweepTimer as { unref?: () => void }).unref === "function") {
    (sweepTimer as { unref: () => void }).unref();
  }
}

function sweep(): void {
  const cutoff = Date.now() - IDLE_TIMEOUT_MS;
  for (const [userId, session] of sessionsByUser.entries()) {
    if (session.isClosed) {
      sessionsByUser.delete(userId);
      continue;
    }
    if (session.lastActivityAt < cutoff) {
      void closeWorkspaceSession(userId, "idle_timeout");
    }
  }
}

export function getWorkspaceSession(userId: string): WorkspaceSession | null {
  const s = sessionsByUser.get(userId);
  if (!s || s.isClosed) {
    if (s?.isClosed) {
      unindexDatabaseId(s);
      sessionsByUser.delete(userId);
    }
    return null;
  }
  return s;
}

/**
 * Look up the active session by the legacy `databaseId` (admin_users.database_id).
 * Used by backend/core handlers that still receive `databaseId` from
 * `user.currentDatabaseId`. Returns `null` if no session is open for the
 * user owning that databaseId.
 */
export function getSessionByDatabaseId(databaseId: string): WorkspaceSession | null {
  if (!databaseId) {
    console.warn(`[getSessionByDatabaseId] called with empty databaseId`);
    return null;
  }
  const userId = userIdByDatabaseId.get(databaseId);
  if (!userId) {
    console.warn(
      `[getSessionByDatabaseId] no session indexed for databaseId=${databaseId}. ` +
      `Indexed databaseIds=[${Array.from(userIdByDatabaseId.keys()).join(", ")}]`,
    );
    return null;
  }
  const session = getWorkspaceSession(userId);
  if (!session) {
    console.warn(
      `[getSessionByDatabaseId] index pointed at userId=${userId} but no live session found`,
    );
  }
  return session;
}

/**
 * Same as getSessionByDatabaseId but throws if not found — for use in
 * handlers where the lack of a session is a programmer error (the gate
 * middleware should have already redirected).
 */
export function requireSessionByDatabaseId(databaseId: string): WorkspaceSession {
  const s = getSessionByDatabaseId(databaseId);
  if (!s) {
    throw new Error(
      `No workspace session is open for databaseId=${databaseId}. ` +
      `Open a workspace from the Open panel first.`,
    );
  }
  return s;
}

export interface OpenWorkspaceArgs {
  userId: string;
  workspaceId: string;
  wfp: WfpFile;
  secret: string | null;
  databaseId?: string;
}

export async function openWorkspaceSession(
  args: OpenWorkspaceArgs,
): Promise<WorkspaceSession> {
  // Switching workspaces (or re-opening the same one) tears down the
  // existing session so no state can leak between them.
  const existing = sessionsByUser.get(args.userId);
  if (existing) {
    unindexDatabaseId(existing);
    await existing.close();
    sessionsByUser.delete(args.userId);
  }

  const session = new WorkspaceSession({
    userId: args.userId,
    workspaceId: args.workspaceId,
    wfp: args.wfp,
    secret: args.secret,
    databaseId: args.databaseId,
  });
  sessionsByUser.set(args.userId, session);
  indexDatabaseId(session);
  ensureSweeper();

  return session;
}

export async function closeWorkspaceSession(
  userId: string,
  reason: "logout" | "switch" | "idle_timeout" | "manual" = "manual",
): Promise<void> {
  const session = sessionsByUser.get(userId);
  if (!session) return;
  console.log(
    `[WorkspaceSession] closing for user=${userId} reason=${reason} workspace=${session.workspaceId}`,
  );
  unindexDatabaseId(session);
  sessionsByUser.delete(userId);
  await session.close();
}

/** Close every open session. Use during graceful shutdown. */
export async function closeAllWorkspaceSessions(): Promise<void> {
  const all = Array.from(sessionsByUser.values());
  sessionsByUser.clear();
  userIdByDatabaseId.clear();
  await Promise.all(all.map((s) => s.close()));
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

// Test-only — reset registry between test cases.
export function __resetWorkspaceSessionStore(): void {
  for (const session of sessionsByUser.values()) {
    void session.close();
  }
  sessionsByUser.clear();
  userIdByDatabaseId.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
