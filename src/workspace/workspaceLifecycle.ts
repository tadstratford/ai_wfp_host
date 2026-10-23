// workspaceLifecycle — orchestrates open / save / disk-import / save-as / close.
//
// Combines three layers:
//   - workspaceStore: encrypted blob CRUD against Supabase
//   - workspaceSessionStore: per-user in-memory session container (M10)
//   - fileFormat: SQLite ↔ .wfp bridge (existing import/export pipeline)
//
// During the M11b–g migration window we maintain dual representation: the
// authoritative state is the encrypted .wfp blob in Supabase (or, for disk-
// ephemeral sessions, just the in-memory snapshot), but `/app` handlers keep
// reading and writing per-user SQLite. On open we hydrate SQLite from the
// .wfp; on save we export SQLite back to .wfp and re-encrypt. As M11c–g
// migrate each area's handlers to use WorkspaceSession accessors directly,
// the SQLite bridge becomes vestigial and is removed in M11h.

import { randomUUID } from "node:crypto";
import type { WfpFile } from "wfp-format";
import { WFP_FORMAT_VERSION } from "wfp-format";
import { EDITION } from "@shared/edition";
import { userManager } from "@backend/core/admin/userManager";
import { decryptWorkspace, isEncryptedEnvelope } from "./crypto";
import {
  closeWorkspaceSession,
  getSessionByDatabaseId,
  getWorkspaceSession,
  openWorkspaceSession,
} from "./workspaceSessionStore";
import { WorkspaceSession } from "./WorkspaceSession";
import {
  createWorkspace as storeCreate,
  getWorkspaceMeta as storeGetMeta,
  openWorkspace as storeOpen,
  saveWorkspace as storeSave,
  listWorkspacesDetailed,
  WorkspaceOpenError,
  type WorkspaceListItem,
} from "./workspaceStore";
import { storeContent } from "./contentStore";

// ── Origins ─────────────────────────────────────────────────────────────────

/**
 * Where the open workspace came from. Stored on the WorkspaceSession via
 * the `ext` slot pattern — placed here to keep the lifecycle module the
 * sole writer of that flag.
 */
export type SessionOrigin =
  | { kind: "supabase"; workspaceId: string; secretHint: string | null }
  | { kind: "disk"; sourceFilename: string }
  | { kind: "memory" };

const ORIGIN_REGISTRY = new WeakMap<WorkspaceSession, SessionOrigin>();

// Auto-save: each supabase-backed session debounce-flushes to its row on
// mutation. The flush fn is also stored so closeActiveWorkspace can do a final
// flush before tearing the session down.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const AUTOSAVE_DELAY_MS = envInt("AUTOSAVE_DELAY_MS", 1500);
const AUTOSAVE_FLUSH = new WeakMap<WorkspaceSession, () => Promise<void>>();

// The Supabase row `updated_at` this session is known to be in sync with.
// Set on open and after every successful flush/save. The pre-run staleness
// check (refreshActiveWorkspaceIfStale) compares this to the row's current
// `updated_at`; a mismatch means another machine/instance wrote since we last
// synced, so we re-hydrate before running. RAM-only, like the session itself.
const SESSION_SYNCED_VERSION = new WeakMap<WorkspaceSession, string>();

function markSynced(session: WorkspaceSession, updatedAt: string | undefined): void {
  if (updatedAt) SESSION_SYNCED_VERSION.set(session, updatedAt);
}

export function getSessionOrigin(session: WorkspaceSession): SessionOrigin | undefined {
  return ORIGIN_REGISTRY.get(session);
}

function setSessionOrigin(session: WorkspaceSession, origin: SessionOrigin): void {
  ORIGIN_REGISTRY.set(session, origin);
  session.onClose(() => {
    ORIGIN_REGISTRY.delete(session);
  });
  attachAutoSave(session);
}

/**
 * Immediately flush the active session's pending changes to storage. Used by
 * quick actions (save/delete a saved prompt) that must survive a page refresh
 * or server restart rather than waiting for the debounced auto-save.
 */
export async function flushActiveWorkspace(databaseId: string): Promise<void> {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return;
  const flush = AUTOSAVE_FLUSH.get(session);
  if (flush) await flush();
}

/**
 * Persist the session to its Supabase row automatically. Plaintext when the
 * session has no secret (shared / plaintext-private), encrypted when it does.
 * No-ops for non-supabase origins (disk-ephemeral, memory).
 */
function attachAutoSave(session: WorkspaceSession): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let retryAttempt = 0;

  const scheduleRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    const delay = Math.min(2000 * 2 ** retryAttempt, 10_000);
    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flush();
    }, delay);
  };

  const flush = async (): Promise<void> => {
    if (flushing || session.isClosed) return;
    const origin = ORIGIN_REGISTRY.get(session);
    if (!origin) return;
    // Disk-ephemeral (legacy) never auto-persists.
    if (origin.kind === "disk") return;
    flushing = true;
    try {
      const wfp = session.exportWfpSnapshot();
      // Capture the sections we're about to write BEFORE the async store call.
      // Sections dirtied *during* the write (e.g. save_data landing mid-flush)
      // must stay dirty so the next flush persists them.
      const sections = session.getDirtySections();
      let workspaceId: string;
      if (origin.kind === "memory") {
        // First real change to a blank workspace → create the hosted row now
        // (lazy creation avoids empty "Untitled" rows) and flip the origin.
        const meta = await storeCreate({
          userId: session.userId,
          wfp,
          secret: session.getSecret(),
          secretHint: null,
        });
        workspaceId = meta.workspaceId;
        ORIGIN_REGISTRY.set(session, {
          kind: "supabase",
          workspaceId: meta.workspaceId,
          secretHint: null,
        });
        markSynced(session, meta.updatedAt);
      } else {
        workspaceId = origin.workspaceId;
        const updatedAt = await storeSave({
          workspaceId: origin.workspaceId,
          wfp,
          secret: session.getSecret(),
          sections,
        });
        markSynced(session, updatedAt);
      }
      session.clearDirtySections(sections);
      session.markSaved();
      // Persist buffered content-addressed payloads so the "Time Machine" can
      // reconstruct historical node values (best-effort, after the main save).
      await flushPendingContent(workspaceId);
      retryAttempt = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    } catch (err) {
      console.error("[autosave] flush failed:", err);
      // Transient failure (e.g. Supabase blip) — retry with backoff instead of
      // abandoning the dirty state until the next edit or close.
      scheduleRetry();
    } finally {
      flushing = false;
    }
  };

  const flushPendingContent = async (workspaceId: string): Promise<void> => {
    const secret = session.getSecret();
    const pending = session.drainPendingContent();
    for (const { hash, value } of pending) {
      try {
        await storeContent(workspaceId, hash, JSON.stringify(value), secret);
      } catch (err) {
        console.error("[autosave] content store write failed:", err);
      }
    }
  };

  session.onMutate(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, AUTOSAVE_DELAY_MS);
  });

  AUTOSAVE_FLUSH.set(session, flush);
  // Checkpoint the end-of-session state before the final flush so the
  // "Time Machine" ledger records "as of close". Runs first (hook order) so
  // the checkpoint event is included in the flush below.
  session.onBeforeClose(() => {
    session.recordCheckpoint({ label: "Session closed" });
  });
  // Final flush on ANY close path (logout, switch, idle timeout, shutdown).
  // Runs before the session is marked closed so exportWfpSnapshot still works.
  session.onBeforeClose(() => void flush());
  session.onClose(() => {
    if (timer) clearTimeout(timer);
    if (retryTimer) clearTimeout(retryTimer);
    AUTOSAVE_FLUSH.delete(session);
  });
}

// ── Public errors ───────────────────────────────────────────────────────────

export { WorkspaceOpenError };

// ── New empty workspace shape ───────────────────────────────────────────────

function emptyWfp(name: string): WfpFile {
  return {
    metadata: {
      format_version: WFP_FORMAT_VERSION,
      workspace: name,
      exported_at: new Date().toISOString(),
    },
    workflows: [],
    tools: [],
    data: {},
    knowledge: [],
    sessions: [],
    provenance: [],
    privacy_mask: { entries: [] },
  };
}

// ── New blank workspace (in-memory, no Supabase row, no prompts) ────────────

export interface CreateBlankArgs {
  userId: string;
  databaseId: string;
  name?: string;
}

/**
 * Create a brand-new, empty workspace. It starts RAM-only (origin `memory`) so
 * that just landing on /app or clicking New doesn't litter the account with
 * empty "Untitled" rows. Auto-save lazily creates the hosted plaintext row on
 * the first real change (see attachAutoSave), after which it behaves like any
 * other hosted workspace.
 */
export async function createBlankWorkspace(
  args: CreateBlankArgs,
): Promise<WorkspaceSession> {
  const name = args.name?.trim() || "Untitled";
  const wfp = emptyWfp(name);

  await userManager.updateWorkspaceName(args.userId, name);

  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: `mem-${randomUUID()}`,
    wfp,
    secret: null,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, { kind: "memory" });
  return session;
}

// ── Open from Supabase ──────────────────────────────────────────────────────

export interface OpenSupabaseWorkspaceArgs {
  userId: string;
  databaseId: string;
  workspaceId: string;
  /** Required for encrypted workspaces; pass null for plaintext ones. */
  secret: string | null;
}

export async function openSupabaseWorkspace(
  args: OpenSupabaseWorkspaceArgs,
): Promise<WorkspaceSession> {
  const { wfp, meta } = await storeOpen({
    workspaceId: args.workspaceId,
    secret: args.secret,
  });

  // Mirror the workspace name onto admin_users so the existing UI bits that
  // still read user.workspaceName show the right title.
  await userManager.updateWorkspaceName(args.userId, wfp.metadata.workspace);

  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: args.secret,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(session, meta.updatedAt);
  return session;
}

/**
 * Open a plaintext workspace headlessly under a SYNTHETIC user/database id
 * (e.g. the email agent's `…::email-agent` shadow identity). Same as
 * `openSupabaseWorkspace` except it never mirrors the workspace name onto
 * `admin_users` (a synthetic id must not create a real user row) and it only
 * opens plaintext workspaces (`secret: null`).
 */
export async function openWorkspaceAsShadow(
  args: OpenSupabaseWorkspaceArgs,
): Promise<WorkspaceSession> {
  const { wfp, meta } = await storeOpen({
    workspaceId: args.workspaceId,
    secret: null,
  });

  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: null,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(session, meta.updatedAt);
  return session;
}

// ── Open a workspace shared with you (live, plaintext, read/write) ──────────

export interface OpenSharedWorkspaceArgs {
  userId: string;
  databaseId: string;
  workspaceId: string;
}

/**
 * Open someone else's shared workspace as a live, read/write session. Shared
 * workspaces are plaintext (Rule #1), so no secret is needed. Authorization
 * (the caller is a member) is checked by the handler before calling this.
 */
export async function openSharedWorkspace(
  args: OpenSharedWorkspaceArgs,
): Promise<WorkspaceSession> {
  const { wfp, meta } = await storeOpen({ workspaceId: args.workspaceId, secret: null });

  await userManager.updateWorkspaceName(args.userId, wfp.metadata.workspace);

  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: null,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(session, meta.updatedAt);
  return session;
}

// ── Privacy toggle by workspace id (encrypt / decrypt a stored workspace) ───

function syncActiveSessionSecret(userId: string, workspaceId: string, secret: string | null): void {
  const session = getWorkspaceSession(userId);
  if (!session) return;
  const origin = getSessionOrigin(session);
  if (origin?.kind === "supabase" && origin.workspaceId === workspaceId) {
    session.changeSecret(secret);
    session.markSaved(); // session now matches the row we just wrote
  }
}

/** Make a plaintext workspace private (encrypt with `secret`). */
export async function encryptWorkspaceById(
  userId: string,
  workspaceId: string,
  secret: string,
): Promise<void> {
  const { wfp } = await storeOpen({ workspaceId, secret: null });
  await storeSave({ workspaceId, wfp, secret });
  syncActiveSessionSecret(userId, workspaceId, secret);
}

/** Make an encrypted workspace shareable (decrypt with its current `secret`).
 *  Throws WorkspaceOpenError("wrong_secret") if the secret is wrong. */
export async function decryptWorkspaceById(
  userId: string,
  workspaceId: string,
  secret: string,
): Promise<void> {
  const { wfp } = await storeOpen({ workspaceId, secret });
  await storeSave({ workspaceId, wfp, secret: null });
  syncActiveSessionSecret(userId, workspaceId, null);
}

// ── Privacy toggle: decrypt the active workspace so it can be shared ────────

/**
 * Remove encryption from the active workspace (make it plaintext) so it can be
 * shared — Rule #1: shared workspaces must be plaintext. Flushes immediately.
 */
export async function makeActiveWorkspacePlaintext(userId: string): Promise<void> {
  const session = getWorkspaceSession(userId);
  if (!session) return;
  if (session.getSecret() === null) return; // already plaintext
  session.changeSecret(null);
  const flush = AUTOSAVE_FLUSH.get(session);
  if (flush) await flush();
}

// ── Open from disk (ephemeral by default) ───────────────────────────────────

export interface OpenDiskWorkspaceArgs {
  userId: string;
  databaseId: string;
  fileContent: string;
  /** Required if the file is an encrypted envelope. Ignored otherwise. */
  passphrase?: string;
  sourceFilename?: string;
}

export async function openDiskWorkspace(
  args: OpenDiskWorkspaceArgs,
): Promise<WorkspaceSession> {
  let plaintext = args.fileContent;

  if (isEncryptedEnvelope(args.fileContent)) {
    if (!args.passphrase) {
      throw new WorkspaceOpenError(
        "wrong_secret",
        "This workspace file is encrypted. A passphrase is required.",
      );
    }
    try {
      plaintext = decryptWorkspace(args.fileContent, args.passphrase);
    } catch (err) {
      throw new WorkspaceOpenError(
        "wrong_secret",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  let wfp: WfpFile;
  try {
    wfp = JSON.parse(plaintext) as WfpFile;
  } catch {
    throw new WorkspaceOpenError(
      "wrong_secret",
      "File is not a valid .wfp document.",
    );
  }
  if (!wfp.metadata?.format_version?.startsWith("1.")) {
    throw new WorkspaceOpenError(
      "wrong_secret",
      `Unsupported .wfp format_version. This app targets ${WFP_FORMAT_VERSION}.`,
    );
  }

  // Always import as a copy: if a hosted workspace with this name already exists,
  // append " (2)", " (3)", … so the import never silently duplicates a name.
  const baseName = wfp.metadata.workspace?.trim() || "Workspace";
  let importName = baseName;
  try {
    const existingNames = new Set((await listWorkspacesDetailed(args.userId)).map((w) => w.name));
    if (existingNames.has(importName)) {
      let n = 2;
      while (existingNames.has(`${baseName} (${n})`)) n++;
      importName = `${baseName} (${n})`;
    }
  } catch (err) {
    console.warn("[openDiskWorkspace] name-collision check failed:", err);
  }
  wfp.metadata.workspace = importName;

  await userManager.updateWorkspaceName(args.userId, importName);

  // Importing from disk creates a hosted, plaintext-private workspace (per the
  // shared-workspaces model). It auto-saves and can be shared like any other.
  const meta = await storeCreate({
    userId: args.userId,
    wfp,
    secret: null,
    secretHint: null,
  });
  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: null,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: null,
  });
  markSynced(session, meta.updatedAt);
  return session;
}

// ── Create a brand-new workspace ────────────────────────────────────────────

export interface CreateAndOpenArgs {
  userId: string;
  databaseId: string;
  name: string;
  /** `null` → shareable/plaintext workspace; a string → private/encrypted. */
  secret: string | null;
  secretHint?: string | null;
}

export async function createAndOpenWorkspace(
  args: CreateAndOpenArgs,
): Promise<WorkspaceSession> {
  const wfp = emptyWfp(args.name);
  const meta = await storeCreate({
    userId: args.userId,
    wfp,
    secret: args.secret,
    secretHint: args.secretHint ?? null,
  });

  await userManager.updateWorkspaceName(args.userId, args.name);

  const session = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: args.secret,
    databaseId: args.databaseId,
  });
  setSessionOrigin(session, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(session, meta.updatedAt);
  return session;
}

// ── Save the currently-open workspace ───────────────────────────────────────

export type SaveResult =
  | { kind: "saved"; workspaceId: string }
  | { kind: "not_supabase_backed"; reason: "disk_ephemeral" }
  | { kind: "no_session_open" };

/**
 * Save the active session's workspace.
 *   - For supabase-backed sessions: snapshot the WorkspaceSession's .wfp →
 *     encrypt → upload to Supabase.
 *   - For disk-ephemeral sessions: returns `not_supabase_backed` (caller
 *     should redirect to Save As).
 *
 * The `databaseId` parameter is unused post-M11c — kept for handler-signature
 * stability while callers migrate.
 */
export async function saveActiveWorkspace(
  userId: string,
  _databaseId: string,
): Promise<SaveResult> {
  const session = getWorkspaceSession(userId);
  if (!session) return { kind: "no_session_open" };
  const origin = getSessionOrigin(session);
  if (!origin || origin.kind !== "supabase") {
    return { kind: "not_supabase_backed", reason: "disk_ephemeral" };
  }
  const secret = session.getSecret();
  if (!secret) {
    return { kind: "not_supabase_backed", reason: "disk_ephemeral" };
  }
  const wfp = session.exportWfpSnapshot();
  const updatedAt = await storeSave({
    workspaceId: origin.workspaceId,
    wfp,
    secret,
  });
  markSynced(session, updatedAt);
  session.markSaved();
  return { kind: "saved", workspaceId: origin.workspaceId };
}

// ── Unified "Save to your account" (handles re-save + first persist) ────────

export interface SaveToAccountArgs {
  userId: string;
  databaseId: string;
  /** New/edited workspace name. */
  name: string;
  /** Required only on first persist (memory/disk origin). For an
   *  already-saved workspace the existing session secret is reused unless
   *  `newSecret` is supplied. */
  secret?: string;
  /** Change the password of an already-saved workspace: re-encrypt with this
   *  secret and update the session. Ignored on first persist. */
  newSecret?: string;
  secretHint?: string | null;
}

export type SaveToAccountResult =
  | { kind: "saved"; workspaceId: string; created: boolean }
  | { kind: "no_session_open" }
  | { kind: "secret_required" };

/**
 * Persist the active session to the user's account (encrypted Supabase row).
 *   - supabase origin → update the existing row in place. Name and hint may
 *     change; the secret does NOT (no rotation). Reuses the session secret.
 *   - memory / disk origin → first persist: create a new row with the given
 *     secret and rebind the session to it (origin becomes supabase).
 */
export async function saveWorkspaceToAccount(
  args: SaveToAccountArgs,
): Promise<SaveToAccountResult> {
  const session = getWorkspaceSession(args.userId);
  if (!session) return { kind: "no_session_open" };
  const origin = getSessionOrigin(session);

  const name = args.name.trim() || session.getWorkspaceName();
  session.updateMetadata({ workspace: name });
  await userManager.updateWorkspaceName(args.userId, name);
  const wfp = session.exportWfpSnapshot();

  // EDITION=local: persist to the local .wfp file store, plaintext, no secret.
  if (EDITION === "local") {
    let workspaceId = origin?.kind === "supabase" ? origin.workspaceId : undefined;
    if (workspaceId) {
      await storeSave({ workspaceId, wfp, secret: null });
    } else {
      const meta = await storeCreate({
        userId: args.userId,
        wfp,
        secret: null,
        secretHint: null,
      });
      workspaceId = meta.workspaceId;
    }
    setSessionOrigin(session, { kind: "supabase", workspaceId, secretHint: null });
    session.markSaved();
    return { kind: "saved", workspaceId, created: false };
  }

  if (origin?.kind === "supabase") {
    const rotating = !!args.newSecret && args.newSecret.length >= 4;
    const secret = rotating ? args.newSecret! : session.getSecret();
    if (!secret) return { kind: "secret_required" };
    const updatedAt = await storeSave({
      workspaceId: origin.workspaceId,
      wfp,
      secret,
      secretHint: args.secretHint ?? undefined,
    });
    markSynced(session, updatedAt);
    if (rotating) session.changeSecret(secret);
    session.markSaved();
    return { kind: "saved", workspaceId: origin.workspaceId, created: false };
  }

  // First persist (memory or disk origin) — a secret is mandatory.
  if (!args.secret || args.secret.length < 4) {
    return { kind: "secret_required" };
  }
  const meta = await storeCreate({
    userId: args.userId,
    wfp,
    secret: args.secret,
    secretHint: args.secretHint ?? null,
  });
  const newSession = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: args.secret,
    databaseId: args.databaseId,
  });
  setSessionOrigin(newSession, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(newSession, meta.updatedAt);
  return { kind: "saved", workspaceId: meta.workspaceId, created: true };
}

// ── Save As — push a disk-ephemeral session (or fork a Supabase one) ───────

export interface SaveAsArgs {
  userId: string;
  databaseId: string;
  name: string;
  secret: string;
  secretHint?: string | null;
}

export async function saveAsNewWorkspace(
  args: SaveAsArgs,
): Promise<WorkspaceListItem> {
  const session = getWorkspaceSession(args.userId);
  if (!session) {
    throw new WorkspaceOpenError(
      "not_found",
      "No workspace is open.",
    );
  }
  // Snapshot the active WorkspaceSession's .wfp and override the workspace name.
  const wfp = session.exportWfpSnapshot();
  wfp.metadata.workspace = args.name;

  const meta = await storeCreate({
    userId: args.userId,
    wfp,
    secret: args.secret,
    secretHint: args.secretHint ?? null,
  });

  await userManager.updateWorkspaceName(args.userId, args.name);

  // Re-open the session against the new Supabase row. closeWorkspaceSession +
  // openWorkspaceSession swap atomically (the store closes existing first).
  const newSession = await openWorkspaceSession({
    userId: args.userId,
    workspaceId: meta.workspaceId,
    wfp,
    secret: args.secret,
    databaseId: args.databaseId,
  });
  setSessionOrigin(newSession, {
    kind: "supabase",
    workspaceId: meta.workspaceId,
    secretHint: meta.secretHint,
  });
  markSynced(newSession, meta.updatedAt);

  return meta;
}

// ── Pre-run freshness check ─────────────────────────────────────────────────

export interface RefreshResult {
  /** True if the session was re-hydrated from a newer Supabase row. */
  refreshed: boolean;
}

/**
 * Ensure the active session reflects the latest persisted state before a
 * workflow run. Compares the Supabase row's `updated_at` to the version this
 * session last synced with; if the row is newer (another machine/instance
 * wrote since), re-hydrate from Supabase using the in-RAM secret so the run
 * uses current data.
 *
 * Cheap path (no change): one metadata-only read (no blob, no decrypt).
 * Only re-downloads + decrypts the blob when the row has actually moved.
 *
 * No-op for non-supabase origins (memory/disk) and when no session is open.
 * Keyed by databaseId because the run handler identifies the user that way.
 */
export async function refreshActiveWorkspaceIfStale(
  databaseId: string,
): Promise<RefreshResult> {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return { refreshed: false };
  const origin = getSessionOrigin(session);
  if (!origin || origin.kind !== "supabase") return { refreshed: false };

  let meta;
  try {
    meta = await storeGetMeta(origin.workspaceId);
  } catch (err) {
    // Storage hiccup — don't block the run; fall through with stale data.
    console.error("[refreshActiveWorkspaceIfStale] meta read failed:", err);
    return { refreshed: false };
  }
  if (!meta) return { refreshed: false };

  const synced = SESSION_SYNCED_VERSION.get(session);
  if (synced && synced === meta.updatedAt) return { refreshed: false };

  // The row is newer than what this instance holds. Re-hydrate from Supabase
  // using the secret already in this session's RAM (null for plaintext).
  await openSupabaseWorkspace({
    userId: session.userId,
    databaseId,
    workspaceId: origin.workspaceId,
    secret: session.getSecret(),
  });
  return { refreshed: true };
}

// ── Close ───────────────────────────────────────────────────────────────────

export async function closeActiveWorkspace(
  userId: string,
  reason: "logout" | "switch" | "manual" = "manual",
): Promise<void> {
  // The final auto-save flush is handled by the session's onBeforeClose hook,
  // so all close paths (including idle timeout and shutdown) persist edits.
  await closeWorkspaceSession(userId, reason);
}
