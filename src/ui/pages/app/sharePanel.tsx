// Whole-workspace sharing (collaborative, plaintext, read/write).
//
// Sharing is managed from the workspace list, per workspace (by id) — no header
// Share button. The owner invites people by email; invitees open the owner's
// LIVE workspace and read/write the same plaintext workspace. Rule #1: only
// plaintext (shareable) workspaces can be shared; private (encrypted) ones
// can't. See docs/shared-workspaces-plan.md.

import { Context } from "hono";
import type { User } from "@backend/types";
import { openSharedWorkspace } from "@backend/core/workspace/workspaceLifecycle";
import { getWorkspaceMeta, isWorkspaceEncrypted } from "@backend/core/workspace/workspaceStore";
import {
  shareWorkspace,
  listWorkspaceMembers,
  isWorkspaceMember,
  getGrant,
  revokeGrant,
  touchGrantAccess,
  type GrantRow,
} from "@backend/core/workspace/workflowGrants";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Modal shell (reuses share-modal-* ids so modalHelpers.js closes it) ──────

function ShareModalShell({ title, children }: { title: string; children: any }) {
  return (
    <div id="share-modal-backdrop" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white dark:bg-ink-800 rounded-xl shadow-2xl border border-ink/[0.08] dark:border-white/[0.08] w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-4">{title}</h2>
        <div>{children}</div>
        <div class="flex justify-end mt-4">
          <button id="share-modal-cancel" type="button" class="px-4 py-2 text-sm text-ink-600 dark:text-white/70 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function renderMembers(workspaceId: string, members: GrantRow[]) {
  return (
    <div id="members-list" class="space-y-1.5">
      {members.length === 0 ? (
        <p class="text-xs text-ink-400 dark:text-ink-500 italic">Not shared with anyone yet.</p>
      ) : (
        members.map((m) => (
          <div class="flex items-center justify-between gap-2 px-3 py-2 border border-ink/[0.08] dark:border-white/[0.08] rounded-lg">
            <div class="min-w-0">
              <div class="text-sm text-ink-700 dark:text-white/80 truncate">{m.grantee_email}</div>
              <div class="text-[11px] text-ink-400 dark:text-ink-500">
                {m.grantee_user_id ? `last opened ${relativeTime(m.last_accessed_at)}` : "invited — not signed in yet"}
              </div>
            </div>
            <button
              hx-delete={`/app/workspaces/${workspaceId}/share/${m.grant_id}`}
              hx-target="#members-list"
              hx-swap="outerHTML"
              class="text-xs px-2 py-1 text-coral-600 dark:text-coral-300 hover:bg-coral-50 dark:hover:bg-coral-900/30 rounded"
            >
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ── Owner: per-workspace share modal (opened from the workspace list) ───────

export const workspaceShareModalView = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);

  if (!meta || meta.userId !== user.userId) {
    return c.html(
      <ShareModalShell title="Share workspace">
        <p class="text-sm text-ink-500">This workspace isn't available to share.</p>
      </ShareModalShell> as any,
    );
  }

  if (await isWorkspaceEncrypted(workspaceId)) {
    return c.html(
      <ShareModalShell title={`Share "${meta.name}"`}>
        <p class="text-sm text-ink-600 dark:text-white/70">
          This workspace is <strong>private (encrypted)</strong> — only you can read it, so it can't
          be shared. To collaborate, create a <strong>shareable</strong> workspace.
        </p>
      </ShareModalShell> as any,
    );
  }

  const members = await listWorkspaceMembers(workspaceId);
  const host = c.req.header("host") || "workflowpeople.com";
  const protocol = host.includes("localhost") ? "http" : "https";
  const appUrl = `${protocol}://${host}/app`;

  return c.html(
    <ShareModalShell title={`Share "${meta.name}"`}>
      <p class="text-xs text-ink-500 mb-3">
        People you invite open this workspace from their list and can read and write it.
      </p>

      <form hx-post={`/app/workspaces/${workspaceId}/share/invite`} hx-target="#members-list" hx-swap="outerHTML" class="flex items-center gap-2 mb-4" autocomplete="off">
        <input
          name="grantee_email"
          type="email"
          required
          placeholder="name@example.com"
          class="flex-1 px-3 py-2 border border-ink/[0.1] dark:border-white/[0.1] rounded-lg text-sm bg-white dark:bg-ink-900 text-ink dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button type="submit" class="px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-xl">
          Invite
        </button>
      </form>

      <h3 class="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">Shared with</h3>
      {renderMembers(workspaceId, members)}

      <div class="mt-4">
        <label class="block text-[11px] text-ink-400 dark:text-ink-500 mb-1">Tell them to open</label>
        <input type="text" value={appUrl} readonly class="w-full px-3 py-2 border border-ink/[0.1] dark:border-white/[0.1] rounded-lg text-xs bg-ink/[0.03] dark:bg-white/[0.03] text-ink-700 dark:text-white/80 select-all" />
      </div>

      <p class="mt-4 text-[11px] text-sun-600 dark:text-sun-300">
        Everyone you share with can read and write this workspace, and can keep a copy.
        Remove someone to end their access.
      </p>
    </ShareModalShell> as any,
  );
};

export const inviteHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);

  if (!meta || meta.userId !== user.userId || (await isWorkspaceEncrypted(workspaceId))) {
    return c.html(<div id="members-list" class="text-xs text-coral-600">This workspace can't be shared.</div>);
  }

  const body = await c.req.parseBody();
  const email = String(body.grantee_email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    const members = await listWorkspaceMembers(workspaceId);
    return c.html(
      <>
        {renderMembers(workspaceId, members)}
        <p class="text-xs text-coral-600 mt-1">Enter a valid email address.</p>
      </>,
    );
  }

  try {
    await shareWorkspace({
      workspaceId,
      workspaceName: meta.name,
      ownerUserId: user.userId,
      ownerEmail: user.userEmail || "",
      granteeEmail: email,
    });
  } catch (err) {
    // The unique index (already shared) is expected — fall through to re-list.
    // Any other failure (e.g. missing table/column) must surface, not vanish.
    const msg = err instanceof Error ? err.message : String(err);
    const isDuplicate = /duplicate|unique|409|23505/i.test(msg);
    if (!isDuplicate) {
      console.error("[share] invite failed:", msg);
      const members = await listWorkspaceMembers(workspaceId);
      return c.html(
        <>
          {renderMembers(workspaceId, members)}
          <p class="text-xs text-coral-600 mt-1">Couldn't share this workspace. Please try again.</p>
        </>,
      );
    }
  }
  const members = await listWorkspaceMembers(workspaceId);
  return c.html(renderMembers(workspaceId, members));
};

export const revokeHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const grantId = c.req.param("grantId");

  const grant = await getGrant(grantId);
  if (grant && grant.owner_user_id === user.userId) {
    await revokeGrant(grantId);
  }

  // Refresh the share modal's member list.
  const members = await listWorkspaceMembers(workspaceId);
  return c.html(renderMembers(workspaceId, members));
};

// ── Invitee: open a shared workspace live ───────────────────────────────────

export const openSharedWorkspaceHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("workspaceId");

  const grant = await isWorkspaceMember(workspaceId, user.userId);
  if (!grant) {
    c.header("HX-Redirect", "/app");
    return c.text("Not shared with you", 403);
  }

  await openSharedWorkspace({
    userId: user.userId,
    databaseId: user.currentDatabaseId,
    workspaceId,
  });
  await touchGrantAccess(grant);

  // Land in the shared workspace's shell — Chat is the opening page.
  c.header("HX-Redirect", "/app/chat");
  return c.body(null);
};

