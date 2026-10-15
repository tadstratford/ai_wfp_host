// accessGrid — the Access tab: a flat, editable access matrix over every client.
//
// Columns: Client | User | Shared with | Inbound | Outbound (checkboxes that
// save on click) + a delete action. Two filters (client, user email) and a
// sort by Client or User. Adding a user happens through a toolbar "Add user"
// modal — never a form hidden below the fold.
//
// "Shared with" maps to a real workspace grant (shareWorkspace / revokeGrant);
// inbound/outbound map to the per-client email allowlists.

import { Context } from "hono";
import type { User } from "@backend/types";
import {
  getWorkspaceMeta,
  isWorkspaceEncrypted,
  type WorkspaceDetail,
} from "@backend/core/workspace/workspaceStore";
import {
  shareWorkspace,
  revokeGrant,
  listWorkspaceMembers,
  type GrantRow,
} from "@backend/core/workspace/workflowGrants";
import {
  ensureInboundAddress,
  normalizeEmail,
  setAllowlist,
  setOutboundAllowlist,
} from "@workspace/emailInbox/address";
import {
  loadCompanyData,
  CompanyNav,
  type CompanyData,
} from "../workspacesPage";
import { serverEmailSections } from "./index";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const TH = "px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-ink-400 font-semibold whitespace-nowrap";
const TD = "px-4 py-2.5 text-sm whitespace-nowrap";

// ── Row model ────────────────────────────────────────────────────────────────

interface AccessRowData {
  workspaceId: string;
  workspaceName: string;
  encrypted: boolean;
  email: string;
  shared: boolean;
  inbound: boolean;
  outbound: boolean;
}

interface Filters {
  client?: string;
  user?: string;
  sort?: string;
}

function buildFlatRows(data: CompanyData): AccessRowData[] {
  const rows: AccessRowData[] = [];
  for (const w of data.owned) {
    const members = data.membersByWs.get(w.workspaceId) ?? [];
    const access = data.accessByWs.get(w.workspaceId);
    const shares = members.map((m) => m.grantee_email);
    const inbound = access?.inbound ?? [];
    const outbound = access?.outbound ?? [];

    const seen = new Set<string>();
    const emails: string[] = [];
    for (const e of [...shares, ...inbound, ...outbound]) {
      if (!seen.has(e)) {
        seen.add(e);
        emails.push(e);
      }
    }
    for (const email of emails) {
      rows.push({
        workspaceId: w.workspaceId,
        workspaceName: w.name,
        encrypted: w.encrypted,
        email,
        shared: shares.includes(email),
        inbound: inbound.includes(email),
        outbound: outbound.includes(email),
      });
    }
  }
  return rows;
}

function applyFilters(rows: AccessRowData[], f: Filters): AccessRowData[] {
  let out = rows;
  if (f.client) out = out.filter((r) => r.workspaceId === f.client);
  if (f.user) {
    const q = f.user.toLowerCase();
    out = out.filter((r) => r.email.toLowerCase().includes(q));
  }
  const sort = f.sort === "user" ? "user" : "client";
  return [...out].sort((a, b) => {
    if (sort === "user") {
      const c = a.email.localeCompare(b.email);
      return c !== 0 ? c : a.workspaceName.localeCompare(b.workspaceName);
    }
    const c = a.workspaceName.localeCompare(b.workspaceName);
    return c !== 0 ? c : a.email.localeCompare(b.email);
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

type AccessKind = "shared" | "inbound" | "outbound";

async function setPermission(
  user: User,
  workspaceId: string,
  email: string,
  kind: AccessKind,
  on: boolean,
): Promise<void> {
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) throw new Error("That client isn't available.");

  if (kind === "shared") {
    if (on && (await isWorkspaceEncrypted(workspaceId))) {
      throw new Error("That client is private — it can't be shared.");
    }
    const members = await listWorkspaceMembers(workspaceId);
    const grant = members.find((m) => m.grantee_email === email);
    if (on && !grant) {
      await shareWorkspace({
        workspaceId,
        workspaceName: meta.name,
        ownerUserId: user.userId,
        ownerEmail: user.userEmail || "",
        granteeEmail: email,
      });
    } else if (!on && grant) {
      await revokeGrant(grant.grant_id);
    }
    return;
  }

  const { address } = await ensureInboundAddress(user.currentDatabaseId, workspaceId, user.userId, meta.name);
  if (kind === "inbound") {
    const list = address.allowlisted_senders;
    if (on !== list.includes(email)) {
      await setAllowlist(address.address_key, on ? [...list, email] : list.filter((e) => e !== email));
    }
  } else {
    const list = address.outbound_allowlist;
    if (on !== list.includes(email)) {
      await setOutboundAllowlist(address.address_key, on ? [...list, email] : list.filter((e) => e !== email));
    }
  }
}

async function clearRow(user: User, workspaceId: string, email: string): Promise<void> {
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) return;

  const members = await listWorkspaceMembers(workspaceId);
  const grant = members.find((m) => m.grantee_email === email);
  if (grant) await revokeGrant(grant.grant_id);

  const { address } = await ensureInboundAddress(user.currentDatabaseId, workspaceId, user.userId, meta.name);
  const inbound = address.allowlisted_senders.filter((e) => e !== email);
  const outbound = address.outbound_allowlist.filter((e) => e !== email);
  if (inbound.length !== address.allowlisted_senders.length) await setAllowlist(address.address_key, inbound);
  if (outbound.length !== address.outbound_allowlist.length) await setOutboundAllowlist(address.address_key, outbound);
}

async function syncRow(
  user: User,
  workspaceId: string,
  email: string,
  flags: { shared: boolean; inbound: boolean; outbound: boolean },
): Promise<void> {
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) throw new Error("That client isn't available.");

  const members = await listWorkspaceMembers(workspaceId);
  const existingGrant = members.find((m) => m.grantee_email === email);
  if (flags.shared && !existingGrant) {
    await shareWorkspace({
      workspaceId,
      workspaceName: meta.name,
      ownerUserId: user.userId,
      ownerEmail: user.userEmail || "",
      granteeEmail: email,
    });
  }

  const { address } = await ensureInboundAddress(user.currentDatabaseId, workspaceId, user.userId, meta.name);
  if (flags.inbound && !address.allowlisted_senders.includes(email)) {
    await setAllowlist(address.address_key, [...address.allowlisted_senders, email]);
  }
  if (flags.outbound && !address.outbound_allowlist.includes(email)) {
    await setOutboundAllowlist(address.address_key, [...address.outbound_allowlist, email]);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function FilterBar(props: { owned: WorkspaceDetail[]; filters: Filters }) {
  const inputCls =
    "rounded-lg border border-ink/[0.12] dark:border-white/[0.12] bg-white dark:bg-ink-800 px-3 py-2 text-sm text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500";
  return (
    <form id="access-filters" class="card p-4 mb-6">
      <div class="flex flex-wrap items-center gap-3">
        <select
          name="client"
          hx-get="/app/workspaces/access/grid"
          hx-target="#access-grid"
          hx-swap="innerHTML"
          hx-include="#access-filters"
          class={inputCls}
        >
          <option value="">All clients</option>
          {props.owned.map((w) => (
            <option value={w.workspaceId} selected={w.workspaceId === props.filters.client}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="user"
          value={props.filters.user || ""}
          placeholder="Filter by user email…"
          hx-get="/app/workspaces/access/grid"
          hx-target="#access-grid"
          hx-swap="innerHTML"
          hx-include="#access-filters"
          hx-trigger="keyup changed delay:300ms"
          class={`${inputCls} min-w-[220px] flex-1`}
        />
      </div>
    </form>
  );
}

function SortHeader(props: { label: string; field: "client" | "user"; sort: string; center?: boolean }) {
  const active = props.sort === props.field;
  return (
    <th class={`${TH} ${props.center ? "text-center" : ""}`}>
      <button
        hx-get={`/app/workspaces/access/grid?sort=${props.field}`}
        hx-include="#access-filters"
        hx-target="#access-grid"
        hx-swap="innerHTML"
        class={`inline-flex items-center gap-1 hover:text-ink dark:hover:text-white ${active ? "text-brand-600 dark:text-brand-300" : ""}`}
      >
        {props.label}
        {active && (
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 14.5 5.5-5.5 5.5 5.5" />
          </svg>
        )}
      </button>
    </th>
  );
}

function CheckboxCell(props: { row: AccessRowData; kind: AccessKind; checked: boolean; sort: string; disabled?: boolean }) {
  return (
    <td class={`${TD} text-center`}>
      <input
        type="checkbox"
        name="value"
        value="1"
        checked={props.checked}
        disabled={props.disabled}
        hx-post="/app/workspaces/access/toggle"
        hx-vals={JSON.stringify({
          kind: props.kind,
          workspaceId: props.row.workspaceId,
          email: props.row.email,
          sort: props.sort,
        })}
        hx-include="#access-filters"
        hx-target="#access-grid"
        hx-swap="innerHTML"
        class="h-4 w-4 rounded accent-brand-500 disabled:opacity-40 cursor-pointer"
      />
    </td>
  );
}

function AccessTable(props: { rows: AccessRowData[]; sort: string }) {
  if (props.rows.length === 0) {
    return (
      <div class="card px-6 py-12 text-center">
        <p class="text-sm text-ink-500 italic">No access entries match.</p>
      </div>
    );
  }
  return (
    <div class="card overflow-hidden">
      <div class="flex items-center justify-between px-4 pt-3 pb-1">
        <span class="text-xs font-semibold text-ink-400">
          {props.rows.length} {props.rows.length === 1 ? "user" : "users"}
        </span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-ink/[0.08] dark:border-white/[0.08]">
              <SortHeader label="Client" field="client" sort={props.sort} />
              <SortHeader label="User" field="user" sort={props.sort} />
              <th class={`${TH} text-center`}>Shared with</th>
              <th class={`${TH} text-center`}>Inbound</th>
              <th class={`${TH} text-center`}>Outbound</th>
              <th class={TH}></th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => {
              const delUrl = `/app/workspaces/access/row?workspaceId=${encodeURIComponent(row.workspaceId)}&email=${encodeURIComponent(row.email)}&sort=${props.sort}`;
              return (
                <tr class="border-b border-ink/[0.06] dark:border-white/[0.06]">
                  <td class={`${TD} font-semibold text-ink dark:text-white`}>{row.workspaceName}</td>
                  <td class={`${TD} text-ink-700 dark:text-white/85`}>{row.email}</td>
                  <CheckboxCell row={row} kind="shared" checked={row.shared} sort={props.sort} disabled={row.encrypted} />
                  <CheckboxCell row={row} kind="inbound" checked={row.inbound} sort={props.sort} />
                  <CheckboxCell row={row} kind="outbound" checked={row.outbound} sort={props.sort} />
                  <td class={`${TD} text-right`}>
                    <button
                      hx-delete={delUrl}
                      hx-include="#access-filters"
                      hx-confirm={`Remove ${row.email} from this client's access?`}
                      hx-target="#access-grid"
                      hx-swap="innerHTML"
                      class="p-1 rounded text-ink-400 hover:text-coral-600 dark:hover:text-coral-300 hover:bg-coral-50 dark:hover:bg-coral-900/20"
                      title="Remove"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 5 14 14M19 5 5 19" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function renderGridInner(user: User, filters: Filters, error?: string) {
  const data = await loadCompanyData(user);
  const rows = applyFilters(buildFlatRows(data), filters);
  return (
    <>
      {error && (
        <div class="mb-3 p-3 text-sm bg-coral-50 dark:bg-coral-900/30 text-coral-600 dark:text-coral-300 border border-coral-200 dark:border-coral-800 rounded-lg">
          {error}
        </div>
      )}
      <AccessTable rows={rows} sort={filters.sort || "client"} />
    </>
  );
}

function AccessModalShell({ title, children }: { title: string; children: any }) {
  return (
    <div id="access-modal-backdrop" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white dark:bg-ink-900 rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink/[0.08] dark:border-white/[0.08]">
          <h2 class="text-base font-semibold text-ink dark:text-white">{title}</h2>
          <button id="cancel-access-modal" class="p-1 text-ink-400 hover:text-ink-600 dark:hover:text-white/80 rounded" aria-label="Close">
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

async function accessModalJsx(user: User, error?: string) {
  const data = await loadCompanyData(user);
  const inputCls =
    "w-full text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-lg px-3 py-2 bg-white dark:bg-ink-800 text-ink dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-500";
  const labelCls = "inline-flex items-center gap-2 text-sm text-ink-600 dark:text-white/80";

  return (
    <AccessModalShell title="Add user">
      <p class="text-xs text-ink-500 mb-4">
        Grant a user access to a client and choose how they can reach it — open it (shared), email in, and email out.
      </p>
      {error && <p class="mb-3 text-xs text-coral-600 dark:text-coral-300">{error}</p>}
      <form
        hx-post="/app/workspaces/access/row"
        hx-target="#modal-container"
        hx-swap="innerHTML"
        hx-include="#access-filters"
        class="space-y-4"
      >
        <div>
          <label class="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">Client</label>
          <select name="workspaceId" required class={inputCls}>
            {data.owned.map((w) => (
              <option value={w.workspaceId}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label class="block text-xs font-semibold text-ink-500 uppercase tracking-wider mb-1">User email</label>
          <input type="email" name="email" required placeholder="name@example.com" class={inputCls} />
        </div>
        <div class="space-y-2">
          <label class={labelCls}>
            <input type="checkbox" name="shared" value="1" class="h-4 w-4 rounded accent-brand-500" /> Shared with
          </label>
          <label class={labelCls}>
            <input type="checkbox" name="inbound" value="1" class="h-4 w-4 rounded accent-brand-500" /> Inbound
          </label>
          <label class={labelCls}>
            <input type="checkbox" name="outbound" value="1" class="h-4 w-4 rounded accent-brand-500" /> Outbound
          </label>
        </div>
        <div class="flex items-center justify-end gap-2 pt-2">
          <button type="submit" class="px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-400 rounded-lg transition-colors">
            Add user
          </button>
        </div>
      </form>
    </AccessModalShell>
  );
}

async function renderAccessPanel(user: User, filters: Filters) {
  const data = await loadCompanyData(user);
  const rows = applyFilters(buildFlatRows(data), filters);
  const serverEmail = await serverEmailSections();

  return (
    <div class="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <div class="flex items-end justify-between gap-4 flex-wrap mb-6">
        <CompanyNav active="access" />
        <span class="text-xs font-semibold text-ink-400">server owner only</span>
      </div>

      <div class="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Access</h1>
          <p class="text-sm text-ink-500 mt-1 max-w-2xl">Who can open each client, and who can email in and out. Server owner only.</p>
        </div>
        <button
          hx-get="/app/workspaces/access/modal"
          hx-target="#modal-container"
          hx-swap="innerHTML"
          class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add user
        </button>
      </div>

      <div class="mb-6 rounded-2xl border border-ink/10 dark:border-white/10 bg-white dark:bg-ink-900 p-5">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-base font-bold text-ink dark:text-white">Server email allowlists</h2>
          <span class="text-xs font-semibold text-ink-400">fail-closed — empty denies all</span>
        </div>
        <div id="server-email">{serverEmail}</div>
      </div>

      <FilterBar owned={data.owned} filters={filters} />
      <div id="access-grid">
        <AccessTable rows={rows} sort={filters.sort || "client"} />
      </div>
    </div>
  );
}

// ── Handlers ─────────────────────────────────────────────────────────────────

function readFilters(c: Context): Filters {
  const q = c.req.query();
  return {
    client: (q.client || "").trim(),
    user: (q.user || "").trim(),
    sort: (q.sort || "client").trim(),
  };
}

export const firmAccessGridView = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(await renderAccessPanel(user, readFilters(c)));
};

/** The grid-only partial (filters/sort/toggle swap target). */
export const accessGridPartial = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(await renderGridInner(user, readFilters(c)));
};

/** The "Add user" modal. */
export const accessAddModal = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(await accessModalJsx(user));
};

const flag = (v: unknown): boolean => v === "1" || v === "on" || v === "true";

/** Create a user's access (modal submit) — merges into existing rows. */
export const accessRowSave = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();

  const workspaceId = String(body.workspaceId ?? "").trim();
  const email = normalizeEmail(String(body.email ?? "").trim());
  const flags = {
    shared: flag(body.shared),
    inbound: flag(body.inbound),
    outbound: flag(body.outbound),
  };
  const filters: Filters = {
    client: String(body.client ?? "").trim(),
    user: String(body.user ?? "").trim(),
    sort: String(body.sort ?? "client").trim(),
  };

  try {
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
    if (flags.shared && (await isWorkspaceEncrypted(workspaceId))) {
      throw new Error("That client is private — it can't be shared.");
    }
    await syncRow(user, workspaceId, email, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't save access.";
    return c.html(await accessModalJsx(user, msg));
  }

  const grid = await renderGridInner(user, filters);
  return c.html(
    <>
      <span id="access-save-trigger" class="hidden"></span>
      <div hx-swap-oob="innerHTML:#access-grid">{grid}</div>
    </>,
  );
};

/** Toggle a single permission (checkbox save-on-click). */
export const accessToggle = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();

  const workspaceId = String(body.workspaceId ?? "").trim();
  const email = normalizeEmail(String(body.email ?? "").trim());
  const kind = String(body.kind ?? "") as AccessKind;
  const on = flag(body.value);
  const filters: Filters = {
    client: String(body.client ?? "").trim(),
    user: String(body.user ?? "").trim(),
    sort: String(body.sort ?? "client").trim(),
  };

  try {
    if (!["shared", "inbound", "outbound"].includes(kind)) throw new Error("Unknown permission.");
    await setPermission(user, workspaceId, email, kind, on);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't update access.";
    return c.html(await renderGridInner(user, filters, msg));
  }

  return c.html(await renderGridInner(user, filters));
};

/** Remove a user entirely from a client's access. */
export const accessRowDelete = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.query("workspaceId") || "";
  const email = normalizeEmail(c.req.query("email") || "");
  if (workspaceId && email) {
    try {
      await clearRow(user, workspaceId, email);
    } catch (err) {
      console.error("[accessGrid] delete failed:", err);
    }
  }
  return c.html(await renderGridInner(user, readFilters(c)));
};
