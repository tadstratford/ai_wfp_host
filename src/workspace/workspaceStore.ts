// workspaceStore — Supabase-backed CRUD for workspace documents.
//
// Each workspace is ONE row in the Supabase `workspaces` table. The .wfp
// document is stored as PER-SECTION encrypted columns — one column per WFP
// section (metadata, workflows, tools, data, knowledge, sessions, logs, misc)
// — so a save only re-encrypts the sections that changed. Each section is an
// AES-256-GCM envelope derived from the user's per-workspace secret word, which
// is NEVER stored — losing it loses the workspace. Sessions and LLM logs live
// INSIDE the document (encrypted together), not in separate tables.
//
// When a workspace has no secret (plaintext), the section columns hold plaintext
// JSON instead of an envelope. Two layers:
//   - Low-level CRUD on the section columns: list/get/create/save/delete
//   - High-level convenience that does the (de)encryption on the way in/out
//
// Decryption failures are explicit: callers must distinguish "wrong secret"
// (user-recoverable: try again) from "no such workspace" (404) from
// "Supabase failure" (transient infra).

import { randomUUID } from "node:crypto";
import type { WfpFile } from "wfp-format";
import * as db from "../server/admin/supabase";
import { EDITION } from "@shared/edition";
import { dataRoot } from "@shared/dataRoot";
import * as fs from "fs";
import * as path from "path";
import { decryptSection, encryptSection, isEncryptedSectionEnvelope } from "./crypto";
import { syncWorkspaceWorkflows } from "./workflowIndex";

const TABLE = "workspaces";

// ── Sections + column mapping ───────────────────────────────────────────────
//
// Small/low-frequency sections (rules, plan, todos) share one
// `enc_misc` column to keep the table narrow. Sessions and LLM logs each get
// their own column (enc_sessions, enc_logs) — still part of the document,
// encrypted with the same secret.

const SECTION_COLS = ["metadata", "workflows", "tools", "data", "knowledge", "sessions", "logs", "misc"] as const;
type SectionCol = (typeof SECTION_COLS)[number];

interface SectionPayload {
  metadata: string;
  workflows: string;
  tools: string | null;
  data: string | null;
  knowledge: string | null;
  sessions: string | null;
  logs: string | null;
  misc: string | null;
}

const COL_FOR: Record<SectionCol, string> = {
  metadata: "enc_metadata",
  workflows: "enc_workflows",
  tools: "enc_tools",
  data: "enc_data",
  knowledge: "enc_knowledge",
  sessions: "enc_sessions",
  logs: "enc_logs",
  misc: "enc_misc",
};

function splitWfp(wfp: WfpFile): SectionPayload {
  const misc: Record<string, unknown> = {};
  if (wfp.rules !== undefined) misc.rules = wfp.rules;
  if (wfp.plan !== undefined) misc.plan = wfp.plan;
  if (wfp.todos !== undefined) misc.todos = wfp.todos;
  if (wfp.saved_prompts !== undefined) misc.saved_prompts = wfp.saved_prompts;

  return {
    metadata: JSON.stringify(wfp.metadata),
    workflows: JSON.stringify(wfp.workflows),
    tools: wfp.tools !== undefined ? JSON.stringify(wfp.tools) : null,
    data: wfp.data !== undefined ? JSON.stringify(wfp.data) : null,
    knowledge: wfp.knowledge !== undefined ? JSON.stringify(wfp.knowledge) : null,
    sessions: wfp.sessions !== undefined ? JSON.stringify(wfp.sessions) : null,
    logs: wfp.logs !== undefined ? JSON.stringify(wfp.logs) : null,
    misc: Object.keys(misc).length > 0 ? JSON.stringify(misc) : null,
  };
}

function joinWfp(payload: SectionPayload): WfpFile {
  const wfp: WfpFile = {
    metadata: JSON.parse(payload.metadata),
    workflows: JSON.parse(payload.workflows),
  };
  if (payload.tools !== null) wfp.tools = JSON.parse(payload.tools);
  if (payload.data !== null) wfp.data = JSON.parse(payload.data);
  if (payload.knowledge !== null) wfp.knowledge = JSON.parse(payload.knowledge);
  if (payload.sessions !== null) wfp.sessions = JSON.parse(payload.sessions);
  if (payload.logs !== null) wfp.logs = JSON.parse(payload.logs);
  if (payload.misc !== null) {
    const misc = JSON.parse(payload.misc) as Record<string, unknown>;
    if (misc.rules !== undefined) wfp.rules = misc.rules as WfpFile["rules"];
    if (misc.plan !== undefined) wfp.plan = misc.plan as WfpFile["plan"];
    if (misc.todos !== undefined) wfp.todos = misc.todos as WfpFile["todos"];
    if (misc.saved_prompts !== undefined) wfp.saved_prompts = misc.saved_prompts as WfpFile["saved_prompts"];
  }
  return wfp;
}

function encodeSection(json: string | null, secret: string | null): string | null {
  if (json === null) return null;
  return secret ? encryptSection(json, secret) : json;
}

function decodeSection(stored: string | null, secret: string | null): string | null {
  if (stored === null) return null;
  if (isEncryptedSectionEnvelope(stored)) {
    if (!secret) {
      throw new WorkspaceOpenError(
        "wrong_secret",
        "This workspace is encrypted. A secret is required.",
      );
    }
    return decryptSection(stored, secret);
  }
  return stored;
}

// ── Row + listing shapes ─────────────────────────────────────────────────────

interface WorkspaceRow {
  workspace_id: string;
  user_id: string;
  name: string;
  secret_hint: string | null;
  description: string | null;
  enc_metadata: string;
  enc_workflows: string;
  enc_tools: string | null;
  enc_data: string | null;
  enc_knowledge: string | null;
  enc_sessions: string | null;
  enc_logs: string | null;
  enc_misc: string | null;
  created_at: string;
  updated_at: string;
}

const META_COLS =
  "workspace_id,user_id,name,secret_hint,description,created_at,updated_at";

export interface WorkspaceListItem {
  workspaceId: string;
  userId: string;
  name: string;
  secretHint: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToListItem(row: Pick<WorkspaceRow, "workspace_id" | "user_id" | "name" | "secret_hint" | "description" | "created_at" | "updated_at">): WorkspaceListItem {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    name: row.name,
    secretHint: row.secret_hint,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Error type ───────────────────────────────────────────────────────────────

export type WorkspaceOpenErrorKind =
  | "not_found"
  | "wrong_secret"
  | "storage_error";

export class WorkspaceOpenError extends Error {
  kind: WorkspaceOpenErrorKind;
  constructor(kind: WorkspaceOpenErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "WorkspaceOpenError";
  }
}

// ── Local (EDITION=local) file-backed workspace store ────────────────────────
//
// Each workspace is one plaintext `.wfp` JSON file under
// dataRoot()/workspaces/{workspaceId}.wfp. No Supabase, no encryption envelope
// (whole-file passphrase encryption is a follow-up). The public functions below
// branch here when EDITION === "local", keeping the exact same signatures so the
// lifecycle + UI flows are unchanged.

function localWorkspacesDir(): string {
  return path.join(dataRoot(), "workspaces");
}

function localFilePath(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(localWorkspacesDir(), `${safe}.wfp`);
}

function localReadWfp(workspaceId: string): { wfp: WfpFile; updatedAt: string } {
  const p = localFilePath(workspaceId);
  if (!fs.existsSync(p)) {
    throw new WorkspaceOpenError("not_found", "Workspace not found.");
  }
  let wfp: WfpFile;
  try {
    wfp = JSON.parse(fs.readFileSync(p, "utf-8")) as WfpFile;
  } catch {
    throw new WorkspaceOpenError("wrong_secret", "Workspace file is not valid JSON.");
  }
  const updatedAt = fs.statSync(p).mtime.toISOString();
  return { wfp, updatedAt };
}

function localWriteWfp(workspaceId: string, wfp: WfpFile): string {
  const dir = localWorkspacesDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = localFilePath(workspaceId);
  fs.writeFileSync(p, JSON.stringify(wfp, null, 2), "utf-8");
  return fs.statSync(p).mtime.toISOString();
}

function localListItem(workspaceId: string, wfp: WfpFile, stat: fs.Stats): WorkspaceListItem {
  return {
    workspaceId,
    userId: "local",
    name: wfp.metadata?.workspace ?? "Untitled",
    secretHint: null,
    description: null,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
  };
}

function localList(): Array<{ id: string; wfp: WfpFile; stat: fs.Stats }> {
  const dir = localWorkspacesDir();
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ id: string; wfp: WfpFile; stat: fs.Stats }> = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".wfp")) continue;
    const id = entry.slice(0, -".wfp".length);
    try {
      const { wfp } = localReadWfp(id);
      out.push({ id, wfp, stat: fs.statSync(localFilePath(id)) });
    } catch {
      // skip unreadable/corrupt files
    }
  }
  out.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());
  return out;
}

// ── Low-level CRUD ───────────────────────────────────────────────────────────

export async function listWorkspaces(userId: string): Promise<WorkspaceListItem[]> {
  if (EDITION === "local") {
    return localList().map((l) => localListItem(l.id, l.wfp, l.stat));
  }
  const result = await db.select<Pick<WorkspaceRow, "workspace_id" | "user_id" | "name" | "secret_hint" | "description" | "created_at" | "updated_at">>(
    TABLE,
    { user_id: userId },
    META_COLS,
  );
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to list workspaces: ${result.error}`,
    );
  }
  const rows = result.data ?? [];
  rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return rows.map(rowToListItem);
}

export interface WorkspaceDetail extends WorkspaceListItem {
  encrypted: boolean;
  sizeBytes: number;
}

/** Owned workspaces with `encrypted` flag + total section size (loads the
 *  section columns — fine for a user's own small list). */
export async function listWorkspacesDetailed(userId: string): Promise<WorkspaceDetail[]> {
  if (EDITION === "local") {
    return localList().map((l) => ({
      ...localListItem(l.id, l.wfp, l.stat),
      encrypted: false,
      sizeBytes: l.stat.size,
    }));
  }
  const result = await db.select<WorkspaceRow>(TABLE, { user_id: userId });
  if (result.error || !result.data) return [];
  return result.data
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((r) => ({
      ...rowToListItem(r),
      encrypted: isEncryptedSectionEnvelope(r.enc_metadata),
      sizeBytes:
        (r.enc_metadata?.length ?? 0) +
        (r.enc_workflows?.length ?? 0) +
        (r.enc_tools?.length ?? 0) +
        (r.enc_data?.length ?? 0) +
        (r.enc_knowledge?.length ?? 0) +
        (r.enc_sessions?.length ?? 0) +
        (r.enc_logs?.length ?? 0) +
        (r.enc_misc?.length ?? 0),
    }));
}

/** Rename a workspace (display name column only — no decrypt needed). */
export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  if (EDITION === "local") {
    const { wfp } = localReadWfp(workspaceId);
    wfp.metadata.workspace = name;
    localWriteWfp(workspaceId, wfp);
    return;
  }
  await updateWorkspaceMeta(workspaceId, { name });
}

/** Update a workspace's display metadata (name and/or description) without
 *  touching the encrypted sections. */
export async function updateWorkspaceMeta(
  workspaceId: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  if (EDITION === "local") {
    const { wfp } = localReadWfp(workspaceId);
    if (patch.name !== undefined) wfp.metadata.workspace = patch.name;
    localWriteWfp(workspaceId, wfp);
    return;
  }
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  const result = await db.update(
    TABLE,
    { workspace_id: workspaceId },
    fields,
  );
  if (result.error) {
    throw new WorkspaceOpenError("storage_error", `Failed to update workspace: ${result.error}`);
  }
}

export async function getWorkspaceMeta(
  workspaceId: string,
): Promise<WorkspaceListItem | null> {
  if (EDITION === "local") {
    try {
      const { wfp, updatedAt } = localReadWfp(workspaceId);
      return {
        workspaceId,
        userId: "local",
        name: wfp.metadata?.workspace ?? "Untitled",
        secretHint: null,
        description: null,
        createdAt: updatedAt,
        updatedAt,
      };
    } catch {
      return null;
    }
  }
  const result = await db.selectOne<Pick<WorkspaceRow, "workspace_id" | "user_id" | "name" | "secret_hint" | "description" | "created_at" | "updated_at">>(
    TABLE,
    { workspace_id: workspaceId },
    META_COLS,
  );
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to load workspace metadata: ${result.error}`,
    );
  }
  return result.data ? rowToListItem(result.data) : null;
}

async function loadEncryptedRow(
  workspaceId: string,
): Promise<WorkspaceRow | null> {
  const result = await db.selectOne<WorkspaceRow>(
    TABLE,
    { workspace_id: workspaceId },
  );
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to load workspace: ${result.error}`,
    );
  }
  return result.data;
}

function rowToPayload(row: WorkspaceRow): SectionPayload {
  return {
    metadata: row.enc_metadata,
    workflows: row.enc_workflows,
    tools: row.enc_tools,
    data: row.enc_data,
    knowledge: row.enc_knowledge,
    sessions: row.enc_sessions,
    logs: row.enc_logs,
    misc: row.enc_misc,
  };
}

function decodeRowPayload(row: WorkspaceRow, secret: string | null): SectionPayload {
  return {
    metadata: decodeSection(row.enc_metadata, secret)!,
    workflows: decodeSection(row.enc_workflows, secret)!,
    tools: decodeSection(row.enc_tools, secret),
    data: decodeSection(row.enc_data, secret),
    knowledge: decodeSection(row.enc_knowledge, secret),
    sessions: decodeSection(row.enc_sessions, secret),
    logs: decodeSection(row.enc_logs, secret),
    misc: decodeSection(row.enc_misc, secret),
  };
}

/** True if the stored metadata section is an encrypted envelope (vs plaintext). */
export async function isWorkspaceEncrypted(workspaceId: string): Promise<boolean> {
  if (EDITION === "local") return false;
  const row = await loadEncryptedRow(workspaceId);
  if (!row) return false;
  return isEncryptedSectionEnvelope(row.enc_metadata);
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  if (EDITION === "local") {
    try {
      fs.unlinkSync(localFilePath(workspaceId));
    } catch {
      /* already gone */
    }
    return;
  }
  const result = await db.del(TABLE, { workspace_id: workspaceId });
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to delete workspace: ${result.error}`,
    );
  }
}

// ── High-level: create / open / save ────────────────────────────────────────

export interface CreateWorkspaceArgs {
  userId: string;
  wfp: WfpFile;
  /** `null` stores the sections as plaintext JSON (server-readable); a string
   *  encrypts them. Plaintext is the default for new/shared workspaces. */
  secret: string | null;
  secretHint?: string | null;
  /** Caller can pre-assign an id (e.g. for disk imports). Default: random. */
  workspaceId?: string;
}

export async function createWorkspace(
  args: CreateWorkspaceArgs,
): Promise<WorkspaceListItem> {
  if (EDITION === "local") {
    const workspaceId = args.workspaceId ?? randomUUID();
    const updatedAt = localWriteWfp(workspaceId, args.wfp);
    return {
      workspaceId,
      userId: args.userId,
      name: args.wfp.metadata.workspace ?? "Untitled",
      secretHint: null,
      description: null,
      createdAt: updatedAt,
      updatedAt,
    };
  }
  const workspaceId = args.workspaceId ?? randomUUID();
  const name = args.wfp.metadata.workspace;
  const payload = splitWfp(args.wfp);

  const now = new Date().toISOString();
  const row: WorkspaceRow = {
    workspace_id: workspaceId,
    user_id: args.userId,
    name,
    secret_hint: args.secretHint ?? null,
    description: null,
    enc_metadata: encodeSection(payload.metadata, args.secret)!,
    enc_workflows: encodeSection(payload.workflows, args.secret)!,
    enc_tools: encodeSection(payload.tools, args.secret),
    enc_data: encodeSection(payload.data, args.secret),
    enc_knowledge: encodeSection(payload.knowledge, args.secret),
    enc_sessions: encodeSection(payload.sessions, args.secret),
    enc_logs: encodeSection(payload.logs, args.secret),
    enc_misc: encodeSection(payload.misc, args.secret),
    created_at: now,
    updated_at: now,
  };

  const result = await db.insert(TABLE, row);
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to create workspace: ${result.error}`,
    );
  }
  await syncWorkspaceWorkflows(workspaceId, args.wfp.workflows ?? []);
  return rowToListItem(row);
}

export interface OpenWorkspaceArgs {
  workspaceId: string;
  /** Required only when the stored sections are encrypted. Plaintext (shared /
   *  plaintext-private) workspaces open without a secret. */
  secret?: string | null;
}

/**
 * Return the .wfp. Plaintext sections are parsed directly (no secret);
 * encrypted ones are decrypted with the secret. Throws WorkspaceOpenError with
 * kind `not_found` (no such row) or `wrong_secret` (missing/wrong secret).
 */
export async function openWorkspace(
  args: OpenWorkspaceArgs,
): Promise<{ wfp: WfpFile; meta: WorkspaceListItem }> {
  if (EDITION === "local") {
    const { wfp, updatedAt } = localReadWfp(args.workspaceId);
    return {
      wfp,
      meta: {
        workspaceId: args.workspaceId,
        userId: "local",
        name: wfp.metadata?.workspace ?? "Untitled",
        secretHint: null,
        description: null,
        createdAt: updatedAt,
        updatedAt,
      },
    };
  }
  const row = await loadEncryptedRow(args.workspaceId);
  if (!row) {
    throw new WorkspaceOpenError("not_found", "Workspace not found.");
  }

  let payload: SectionPayload;
  try {
    payload = decodeRowPayload(row, args.secret ?? null);
  } catch (err) {
    if (err instanceof WorkspaceOpenError) throw err;
    throw new WorkspaceOpenError(
      "wrong_secret",
      err instanceof Error ? err.message : String(err),
    );
  }

  let wfp: WfpFile;
  try {
    wfp = joinWfp(payload);
  } catch {
    throw new WorkspaceOpenError(
      "wrong_secret",
      "Decrypted content is not valid JSON. The workspace may be corrupted.",
    );
  }
  // Populate the workflow-name cache so cross-workspace lists are current.
  await syncWorkspaceWorkflows(args.workspaceId, wfp.workflows ?? []);

  return { wfp, meta: rowToListItem(row) };
}

export interface SaveWorkspaceArgs {
  workspaceId: string;
  wfp: WfpFile;
  /** `null` stores sections plaintext (shared / plaintext-private); a string
   *  encrypts. */
  secret: string | null;
  /** Update the secret hint at the same time. Pass undefined to leave as-is. */
  secretHint?: string | null;
  /** Restrict the write to these sections (incremental save). Omit to write
   *  every section. `name` + `updated_at` are always written. */
  sections?: SectionCol[];
}

/** Returns the new `updated_at` timestamp written to the row, so callers can
 *  track which row version a session is in sync with (used by the pre-run
 *  staleness check). */
export async function saveWorkspace(args: SaveWorkspaceArgs): Promise<string> {
  if (EDITION === "local") {
    return localWriteWfp(args.workspaceId, args.wfp);
  }
  const payload = splitWfp(args.wfp);
  const only = args.sections ? new Set(args.sections) : null;

  const updatedAt = new Date().toISOString();
  const patch: Record<string, unknown> = {
    name: args.wfp.metadata.workspace,
    updated_at: updatedAt,
  };
  if (!only || only.has("metadata")) patch.enc_metadata = encodeSection(payload.metadata, args.secret);
  if (!only || only.has("workflows")) patch.enc_workflows = encodeSection(payload.workflows, args.secret);
  if (!only || only.has("tools")) patch.enc_tools = encodeSection(payload.tools, args.secret);
  if (!only || only.has("data")) patch.enc_data = encodeSection(payload.data, args.secret);
  if (!only || only.has("knowledge")) patch.enc_knowledge = encodeSection(payload.knowledge, args.secret);
  if (!only || only.has("sessions")) patch.enc_sessions = encodeSection(payload.sessions, args.secret);
  if (!only || only.has("logs")) patch.enc_logs = encodeSection(payload.logs, args.secret);
  if (!only || only.has("misc")) patch.enc_misc = encodeSection(payload.misc, args.secret);
  if (args.secretHint !== undefined) {
    patch.secret_hint = args.secretHint;
  }

  const result = await db.update(
    TABLE,
    { workspace_id: args.workspaceId },
    patch,
  );
  if (result.error) {
    throw new WorkspaceOpenError(
      "storage_error",
      `Failed to save workspace: ${result.error}`,
    );
  }
  await syncWorkspaceWorkflows(args.workspaceId, args.wfp.workflows ?? []);
  return updatedAt;
}
