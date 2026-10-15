// workspaceAccess — per-client inbound/outbound email allowlist editing.
//
// These edit the PER-CLIENT allowlists stored on the workspace's inbound email
// address row (`inbound_email_addresses.allowlisted_senders` and
// `outbound_allowlist`), which are distinct from the server-instance-wide lists
// in serverAllowlist.ts. Reachable from the client card's vertical-ellipsis
// menu on the company page (Clients tab). Server owner only.

import { Context } from "hono";
import type { User } from "@backend/types";
import { getWorkspaceMeta } from "@backend/core/workspace/workspaceStore";
import {
  ensureInboundAddress,
  normalizeEmail,
  setAllowlist,
  setOutboundAllowlist,
} from "@workspace/emailInbox/address";
import { renderCompanyHome, renderWorkspacesTable } from "./workspacesPage";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type AccessKind = "inbound" | "outbound";

const KIND_LABEL: Record<AccessKind, string> = {
  inbound: "Can email in",
  outbound: "Can be emailed",
};

const KIND_HINT: Record<AccessKind, string> = {
  inbound: "Senders this client will accept email from. Empty = accept anyone (unless the server-wide list also restricts).",
  outbound: "Recipients this client may email. Empty = send to anyone (unless the server-wide list also restricts).",
};

function AccessModalShell({ title, children }: { title: string; children: any }) {
  return (
    <div id="access-modal-backdrop" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white dark:bg-ink-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink/[0.08] dark:border-white/[0.08]">
          <h2 class="text-base font-semibold text-ink dark:text-white">{title}</h2>
          <button
            id="cancel-access-modal"
            class="p-1 text-ink-400 hover:text-ink-600 dark:hover:text-white/80 rounded"
            aria-label="Close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

interface LoadedAccess {
  addressKey: string;
  inbound: string[];
  outbound: string[];
}

async function loadAccess(user: User, workspaceId: string, workspaceName?: string): Promise<LoadedAccess> {
  const { address } = await ensureInboundAddress(
    user.currentDatabaseId,
    workspaceId,
    user.userId,
    workspaceName,
  );
  return {
    addressKey: address.address_key,
    inbound: address.allowlisted_senders,
    outbound: address.outbound_allowlist,
  };
}

function listFor(kind: AccessKind, access: LoadedAccess): string[] {
  return kind === "inbound" ? access.inbound : access.outbound;
}

/** Pure JSX for the access-editing modal (so views and mutations can compose it
 *  with out-of-band refreshes). */
async function accessModalJsx(kind: AccessKind, user: User, workspaceId: string, error?: string) {
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return (
      <AccessModalShell title="Access">
        <p class="text-sm text-ink-500">This workspace isn't available.</p>
      </AccessModalShell>
    );
  }

  const access = await loadAccess(user, workspaceId, meta.name);
  const emails = listFor(kind, access);
  const addUrl = `/app/workspaces/${workspaceId}/access/${kind}`;
  const removeUrl = `/app/workspaces/${workspaceId}/access/${kind}?email=`;
  const inputCls =
    "flex-1 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-lg px-3 py-2 bg-white dark:bg-ink-800 text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <AccessModalShell title={`${KIND_LABEL[kind]} — ${meta.name}`}>
      <p class="text-xs text-ink-500 mb-4">{KIND_HINT[kind]}</p>

      {error && <p class="mb-3 text-xs text-coral-600 dark:text-coral-300">{error}</p>}

      <div id="ws-access-list" class="space-y-1.5 mb-4">
        {emails.length === 0 ? (
          <p class="text-xs text-ink-400 dark:text-ink-500 italic">None yet.</p>
        ) : (
          emails.map((email) => (
            <div class="flex items-center justify-between gap-2 rounded-lg border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-3 py-1.5">
              <span class="text-sm text-ink-700 dark:text-white/80 font-mono truncate">{email}</span>
              <button
                hx-delete={`${removeUrl}${encodeURIComponent(email)}`}
                hx-target="#modal-container"
                hx-swap="innerHTML"
                class="text-xs text-ink-400 hover:text-coral-500 dark:hover:text-coral-400 shrink-0"
                title="Remove"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <form hx-post={addUrl} hx-target="#modal-container" hx-swap="innerHTML" class="flex items-center gap-2">
        <input type="email" name="email" required placeholder="name@example.com" class={inputCls} />
        <button class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors">
          Add
        </button>
      </form>
    </AccessModalShell>
  );
}

function makeView(kind: AccessKind) {
  return async (c: Context) => {
    const user = c.get("user") as User;
    return c.html(await accessModalJsx(kind, user, c.req.param("id")));
  };
}

async function mutate(
  c: Context,
  kind: AccessKind,
  action: "add" | "remove",
  user: User,
  workspaceId: string,
  email: string,
): Promise<Response> {
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return c.html(await accessModalJsx(kind, user, workspaceId, "This workspace isn't available."));
  }

  const access = await loadAccess(user, workspaceId, meta.name);
  const list = listFor(kind, access);
  const normalized = normalizeEmail(email);
  let next: string[];
  let error: string | undefined;
  if (action === "add") {
    if (!EMAIL_RE.test(normalized)) {
      error = "Enter a valid email address.";
      next = list;
    } else {
      next = list.includes(normalized) ? list : [...list, normalized];
    }
  } else {
    next = list.filter((e) => e !== normalized);
  }

  if (!error) {
    if (kind === "inbound") {
      await setAllowlist(access.addressKey, next);
    } else {
      await setOutboundAllowlist(access.addressKey, next);
    }
  }

  // Re-render the modal in place (primary swap target is #modal-container) and
  // refresh the underlying company page/list out-of-band so the Access section
  // stays in sync.
  return c.html(
    <>
      {await accessModalJsx(kind, user, workspaceId, error)}
      <div hx-swap-oob="innerHTML:#firm-panel">{await renderCompanyHome(user)}</div>
      <div hx-swap-oob="innerHTML:#workspace-list">{await renderWorkspacesTable(user)}</div>
    </>,
  );
}

export const workspaceInboundModal = makeView("inbound");
export const workspaceOutboundModal = makeView("outbound");

export const workspaceInboundAdd = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  return mutate(c, "inbound", "add", user, c.req.param("id"), String(body.email ?? "").trim());
};

export const workspaceInboundRemove = async (c: Context) => {
  const user = c.get("user") as User;
  return mutate(c, "inbound", "remove", user, c.req.param("id"), c.req.query("email") || "");
};

export const workspaceOutboundAdd = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  return mutate(c, "outbound", "add", user, c.req.param("id"), String(body.email ?? "").trim());
};

export const workspaceOutboundRemove = async (c: Context) => {
  const user = c.get("user") as User;
  return mutate(c, "outbound", "remove", user, c.req.param("id"), c.req.query("email") || "");
};
