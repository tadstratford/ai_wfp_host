import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { previewWorkspace, type WfpPreview } from "./preview";
import { encryptWorkspace, decryptWorkspace } from "./crypto";
import { getSessionByDatabaseId } from "./workspaceSessionStore";
import * as db from "../server/admin/supabase";
import { dataRoot } from "../shared/dataRoot";

const TUTORIAL_DIR = join(dataRoot(), "data", "tutorials");
const TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export interface SharedWorkflowMeta {
  uuid: string;
  senderName: string;
  workspaceName: string;
  description: string | null;
  isExample: boolean;
  createdAt: string;
  expiresAt: string;
  preview: {
    workflowCount: number;
    toolCount: number;
    dataFileCount: number;
  };
}

interface SharedWorkflowRow {
  uuid: string;
  sender_name: string;
  workspace_name: string;
  encrypted_content: string;
  description: string | null;
  is_example: boolean;
  preview_workflow_count: number;
  preview_tool_count: number;
  preview_data_file_count: number;
  created_at: string;
  expires_at: string;
}

function rowToMeta(row: SharedWorkflowRow): SharedWorkflowMeta {
  return {
    uuid: row.uuid,
    senderName: row.sender_name,
    workspaceName: row.workspace_name,
    description: row.description || null,
    isExample: row.is_example || false,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    preview: {
      workflowCount: row.preview_workflow_count,
      toolCount: row.preview_tool_count,
      dataFileCount: row.preview_data_file_count,
    },
  };
}

// ── Save a shared workflow ────────────────────────────────────────────────────

export async function saveSharedWorkflow(
  databaseId: string,
  workspaceName: string,
  passphrase: string,
  senderName: string,
): Promise<{ uuid: string; meta: SharedWorkflowMeta }> {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) {
    throw new Error("No workspace session open — cannot share.");
  }
  const wfp = session.exportWfpSnapshot();
  wfp.metadata.workspace = workspaceName;
  const plaintext = JSON.stringify(wfp);
  const preview = previewWorkspace(plaintext);
  const encrypted = encryptWorkspace(plaintext, passphrase);
  const uuid = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);

  const row = {
    uuid,
    sender_name: senderName,
    workspace_name: workspaceName,
    encrypted_content: encrypted,
    preview_workflow_count: preview.workflows.length,
    preview_tool_count: preview.customTools.length,
    preview_data_file_count: preview.userDataFiles.length,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };

  const result = await db.insert("shared_workflows", row);
  if (result.error) {
    throw new Error(`Failed to save shared workflow: ${result.error}`);
  }

  const meta = rowToMeta(row as SharedWorkflowRow);
  console.log(`[Share] Saved shared workflow: ${uuid} (expires ${meta.expiresAt})`);
  return { uuid, meta };
}

// ── Load a shared workflow ────────────────────────────────────────────────────

export async function loadSharedMeta(uuid: string): Promise<SharedWorkflowMeta | null> {
  const result = await db.selectOne<SharedWorkflowRow>(
    "shared_workflows",
    { uuid },
    "uuid,sender_name,workspace_name,description,is_example,preview_workflow_count,preview_tool_count,preview_data_file_count,created_at,expires_at",
  );
  if (result.error || !result.data) return null;

  // Check expiry (examples never expire)
  if (!result.data.is_example && new Date(result.data.expires_at) < new Date()) {
    await cleanupShare(uuid);
    return null;
  }

  return rowToMeta(result.data);
}

export async function loadSharedEncrypted(uuid: string): Promise<string | null> {
  const result = await db.selectOne<SharedWorkflowRow>(
    "shared_workflows",
    { uuid },
    "encrypted_content,is_example,expires_at",
  );
  if (result.error || !result.data) return null;

  // Examples never expire
  if (!result.data.is_example && new Date(result.data.expires_at) < new Date()) {
    await cleanupShare(uuid);
    return null;
  }

  return result.data.encrypted_content;
}

export function decryptShared(encryptedContent: string, passphrase: string): string {
  return decryptWorkspace(encryptedContent, passphrase);
}

// ── Tutorial workflows ────────────────────────────────────────────────────────

const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export function loadTutorialWorkflow(slug: string): string | null {
  if (!SLUG_RE.test(slug)) return null;
  const filePath = join(TUTORIAL_DIR, `${slug}.wfp`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

// ── Cleanup expired shares ────────────────────────────────────────────────────

async function cleanupShare(uuid: string) {
  await db.del("shared_workflows", { uuid });
}

export async function cleanupExpiredShares(): Promise<number> {
  // Use Supabase RPC or manual select + delete
  const result = await db.select<SharedWorkflowRow>(
    "shared_workflows",
    {},
    "uuid,expires_at,is_example",
  );
  if (result.error || !result.data) return 0;

  const now = new Date();
  let removed = 0;

  for (const row of result.data) {
    // Never clean up examples
    if (row.is_example) continue;
    if (new Date(row.expires_at) < now) {
      await db.del("shared_workflows", { uuid: row.uuid });
      removed++;
    }
  }

  if (removed > 0) console.log(`[Share] Cleaned up ${removed} expired share(s)`);
  return removed;
}

// ── List example workspaces ─────────────────────────────────────────────────

export async function listExamples(): Promise<SharedWorkflowMeta[]> {
  const result = await db.select<SharedWorkflowRow>(
    "shared_workflows",
    { is_example: true },
    "uuid,sender_name,workspace_name,description,is_example,preview_workflow_count,preview_tool_count,preview_data_file_count,created_at,expires_at",
  );
  if (result.error || !result.data) return [];
  return result.data.map(rowToMeta);
}
