// Open panel — workspace list + lifecycle modals, rendered into #main-panel.
//
// Reached via the Open action (GET /app/open). Users explicitly choose a
// workspace (decrypt with secret) or open one from disk (ephemeral). It is
// also the empty-state default for #main-panel when no session is open, so a
// brand-new user lands here after login instead of on a separate page.
//
// Per-WFP secret is never recoverable. The UI says so at create time and
// shows the optional hint at open time.

import { Context } from "hono";
import type { User } from "@backend/types";
import { Mark } from "@frontend/components/logo";
import { SERVER_NAME, WORKSPACE_LABEL, WORKSPACE_LABEL_PLURAL } from "@backend/core/settings/instanceConfig";
import { EDITION } from "@shared/edition";
import {
  WorkspaceOpenError,
  closeActiveWorkspace,
  createAndOpenWorkspace,
  createBlankWorkspace,
  getSessionOrigin,
  openDiskWorkspace,
  openSupabaseWorkspace,
  openSharedWorkspace,
  encryptWorkspaceById,
  decryptWorkspaceById,
  saveActiveWorkspace,
  saveAsNewWorkspace,
  saveWorkspaceToAccount,
} from "@backend/core/workspace/workspaceLifecycle";
import { getWorkspaceSession } from "@backend/core/workspace/workspaceSessionStore";

import {
  deleteWorkspace,
  getWorkspaceMeta,
  isWorkspaceEncrypted,
  listWorkspacesDetailed,
  renameWorkspace,
  updateWorkspaceMeta,
  type WorkspaceDetail,
  type WorkspaceListItem,
} from "@backend/core/workspace/workspaceStore";
import { isEncryptedEnvelope } from "@backend/core/workspace/crypto";
import { listWorkspaceWorkflows, type WorkflowIndexEntry } from "@backend/core/workspace/workflowIndex";
import { workspaceChatModalView } from "./workflows/workspacePanel";
import {
  claimGrants,
  listSharedWorkspaces,
  listWorkspacesSharedByOwner,
  listWorkspaceMembers,
  isWorkspaceMember,
  type GrantRow,
} from "@backend/core/workspace/workflowGrants";
import { loadAppSkills, type SkillWithSource } from "@core/skills/loader";
import {
  getInboundAddressByWorkspace,
  revealFullAddress,
  rotateSecret,
} from "@workspace/emailInbox/address";

// ── Pending-upload stash for disk imports needing a passphrase ──────────────
// Keyed by userId, single slot, TTL 5 min. Cleared on consume.

interface PendingUpload {
  content: string;
  filename: string;
  createdAt: number;
}
const PENDING_UPLOAD_TTL_MS = 5 * 60 * 1000;
const pendingUploads = new Map<string, PendingUpload>();

function stashUpload(userId: string, content: string, filename: string): void {
  pendingUploads.set(userId, { content, filename, createdAt: Date.now() });
}
function takeUpload(userId: string): PendingUpload | null {
  const u = pendingUploads.get(userId);
  if (!u) return null;
  pendingUploads.delete(userId);
  if (Date.now() - u.createdAt > PENDING_UPLOAD_TTL_MS) return null;
  return u;
}

// ── Company page (the mockup at MOCKUP_V5/company_level.html, fully merged
//    onto /app/workspaces — Clients + Firm Skills + Access + Email Whitelist
//    sections + a right rail with "This week" and "Recent activity").
//    Used by `firmClientsView` (the Clients tab inside the firm shell). ──────

const SECTION_HEAD = "text-[11px] font-bold uppercase tracking-wider text-ink-500 mb-3";
const SECTION_COUNT = "text-xs font-semibold text-ink-400";

export interface WorkspaceAccess {
  inbound: string[];   // allowlisted_senders — who may email in
  outbound: string[];  // outbound_allowlist — who the client may email
  inboxAddress: string;
  addressKey: string;
}

async function loadAccessByWorkspace(owned: WorkspaceDetail[]): Promise<Map<string, WorkspaceAccess>> {
  const map = new Map<string, WorkspaceAccess>();
  await Promise.all(
    owned.map(async (w) => {
      try {
        const addr = await getInboundAddressByWorkspace(w.workspaceId);
        map.set(w.workspaceId, {
          inbound: addr?.allowlisted_senders ?? [],
          outbound: addr?.outbound_allowlist ?? [],
          inboxAddress: addr ? revealFullAddress(addr) : "",
          addressKey: addr?.address_key ?? "",
        });
      } catch {
        map.set(w.workspaceId, { inbound: [], outbound: [], inboxAddress: "", addressKey: "" });
      }
    }),
  );
  return map;
}

export interface CompanyData {
  owned: WorkspaceDetail[];
  incoming: GrantRow[];
  outgoing: GrantRow[];
  membersByWs: Map<string, GrantRow[]>;
  accessByWs: Map<string, WorkspaceAccess>;
  workflowsByWs: Map<string, WorkflowIndexEntry[]>;
  skills: SkillWithSource[];
}

/** Load everything the company page (Home + Access) needs in one pass. */
export async function loadCompanyData(user: User): Promise<CompanyData> {
  const [owned, incoming, outgoing] = await Promise.all([
    listWorkspacesDetailed(user.userId).catch(() => [] as WorkspaceDetail[]),
    listSharedWorkspaces(user.userId).catch(() => [] as GrantRow[]),
    listWorkspacesSharedByOwner(user.userId).catch(() => [] as GrantRow[]),
  ]);
  const skills = loadAppSkills();
  const membersByWs = new Map<string, GrantRow[]>();
  for (const g of outgoing) {
    const arr = membersByWs.get(g.workspace_id) ?? [];
    arr.push(g);
    membersByWs.set(g.workspace_id, arr);
  }
  const accessByWs = await loadAccessByWorkspace(owned);
  const workflowsByWs = await listWorkspaceWorkflows(owned.map((w) => w.workspaceId));

  return { owned, incoming, outgoing, membersByWs, accessByWs, workflowsByWs, skills };
}

/** Clients / Access tab nav — replaces the old "Company" page head. */
const CLIENTS_NAV_ICON =
  "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z";
const ACCESS_NAV_ICON =
  "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z";

function NavIcon({ path }: { path: string }) {
  return (
    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d={path} />
    </svg>
  );
}

export function CompanyNav({ active }: { active: "clients" | "access" }) {
  const base =
    "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer no-underline";
  const on = `${base} bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300`;
  const off = `${base} text-ink-500 hover:bg-ink/[0.04] dark:hover:bg-white/[0.06]`;
  return (
    <nav class="inline-flex items-center gap-1">
      <a
        hx-get="/app/workspaces"
        hx-target="#firm-panel"
        hx-swap="innerHTML"
        hx-push-url="/app/workspaces"
        class={active === "clients" ? on : off}
      >
        <NavIcon path={CLIENTS_NAV_ICON} />
        {WORKSPACE_LABEL_PLURAL}
      </a>
      <a
        hx-get="/app/workspaces/access"
        hx-target="#firm-panel"
        hx-swap="innerHTML"
        hx-push-url="/app/workspaces/access"
        class={active === "access" ? on : off}
      >
        <NavIcon path={ACCESS_NAV_ICON} />
        Access
      </a>
    </nav>
  );
}

/** The Home tab — clients + shared + firm skills + right rail (no Access). */
export async function renderCompanyHome(user: User) {
  const { owned, incoming, accessByWs, workflowsByWs, skills } = await loadCompanyData(user);

  return (
    <div class="max-w-[1440px] mx-auto px-4 md:px-8 py-6 md:py-8">
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
        <div class="min-w-0 space-y-8">
          <div class="flex items-end justify-between gap-4 flex-wrap mb-6">
            <CompanyNav active="clients" />
            <div class="flex items-center gap-2">
              <button
                hx-get="/app/workspaces/modal/new"
                hx-target="#modal-container"
                hx-swap="innerHTML"
                class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 transition-colors"
              >
                <PillIcon path={ICON_PLUS} size={16} />
                New client
              </button>
              <label class="inline-flex items-center gap-2 rounded-xl border border-ink/[0.1] px-4 py-2.5 text-sm font-semibold text-ink-700 dark:text-white/85 cursor-pointer hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] transition-colors">
                <PillIcon path={ICON_UPLOAD} size={16} />
                From Disk
                <input
                  type="file"
                  name="file"
                  accept=".wfp,application/json"
                  class="hidden"
                  hx-post="/app/workspaces/disk/upload"
                  hx-encoding="multipart/form-data"
                  hx-trigger="change"
                  hx-target="#modal-container"
                  hx-swap="innerHTML"
                />
              </label>
            </div>
          </div>
          <ClientsSection owned={owned} workflowsByWs={workflowsByWs} accessByWs={accessByWs} />
          <SharedWithYouSection incoming={incoming} />
          <FirmSkillsSection skills={skills} />
        </div>
        <aside class="space-y-6">
          <ThisWeekCard owned={owned} />
          <RecentActivityCard owned={owned} />
        </aside>
      </div>
    </div>
  );
}

// ── Clients section: card grid + Add client dashed tile ──────────────────────

function ClientsSection(props: { owned: WorkspaceDetail[]; workflowsByWs: Map<string, WorkflowIndexEntry[]>; accessByWs: Map<string, WorkspaceAccess> }) {
  return (
    <section id="firm-clients">
      <div class="flex items-center justify-between mb-3">
        <h2 class={SECTION_HEAD}>Clients</h2>
        <span class={SECTION_COUNT}>{props.owned.length} {props.owned.length === 1 ? "workspace" : "workspaces"}</span>
      </div>
      {props.owned.length === 0 ? (
        <p class="text-sm text-ink-500 italic">No clients yet. Use "New client" to create one.</p>
      ) : (
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {props.owned.map((w, i) => renderClientCard(w, i, props.workflowsByWs.get(w.workspaceId) ?? [], props.accessByWs.get(w.workspaceId)))}
          <button
            hx-get="/app/workspaces/modal/new"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="flex min-h-[132px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink/[0.13] p-5 text-ink-400 hover:text-brand-500 hover:border-brand-300 dark:border-white/[0.12] dark:hover:border-brand-400 transition"
          >
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white border border-ink/[0.09] text-brand-500 dark:bg-ink-800 dark:border-white/[0.09]">
              <PillIcon path={ICON_PLUS} size={16} />
            </span>
            <span class="mt-2 text-xs font-semibold">Add client</span>
          </button>
        </div>
      )}
    </section>
  );
}

function SharedWithYouSection(props: { incoming: GrantRow[] }) {
  if (props.incoming.length === 0) return <></>;
  return (
    <section>
      <h2 class={SECTION_HEAD}>Shared with you</h2>
      <div class="space-y-2">{props.incoming.map(renderIncomingRow)}</div>
    </section>
  );
}

function FirmSkillsSection(props: { skills: { name: string; scope?: string; description?: string }[] }) {
  return (
    <section id="firm-skills">
      <div class="flex items-center justify-between mb-3">
        <h2 class={SECTION_HEAD}>Firm skills</h2>
        <span class={SECTION_COUNT}>shared across clients</span>
      </div>
      {props.skills.length === 0 ? (
        <p class="text-sm text-ink-500 italic">No firm skills configured.</p>
      ) : (
        <div class="flex flex-wrap gap-2.5">
          {props.skills.slice(0, 8).map((s) => (
            <span class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
              <PillIcon path={ICON_SPARKLE} size={14} />
              {s.name}
            </span>
          ))}
          <button class="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/30 transition">
            <PillIcon path={ICON_PLUS} size={14} />
            Add skill
          </button>
        </div>
      )}
    </section>
  );
}

// ── Right rail ───────────────────────────────────────────────────────────────

function ThisWeekCard(props: { owned: WorkspaceDetail[] }) {
  const total = props.owned.length;
  return (
    <div class="card p-5">
      <h2 class={SECTION_HEAD}>This week</h2>
      <div class="mt-4 space-y-4">
        <div>
          <div class="flex items-center justify-between text-sm mb-1.5">
            <span class="text-ink-600 dark:text-white">Awaiting you</span>
            <span class="font-bold text-ink dark:text-white tabular-nums">—</span>
          </div>
          <div class="h-2 rounded-full bg-ink/[0.07] dark:bg-white/[0.08] overflow-hidden">
            <div class="h-full w-0 rounded-full bg-sun-500"></div>
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between text-sm mb-1.5">
            <span class="text-ink-600 dark:text-white">Correct this week</span>
            <span class="font-bold text-ink dark:text-white tabular-nums">—</span>
          </div>
          <div class="h-2 rounded-full bg-ink/[0.07] dark:bg-white/[0.08] overflow-hidden">
            <div class="h-full w-0 rounded-full bg-leaf-500"></div>
          </div>
        </div>
        <div class="text-[11px] text-ink-400 pt-1">
          Across {total} {total === 1 ? "workspace" : "workspaces"}.
        </div>
      </div>
    </div>
  );
}

function RecentActivityCard(props: { owned: WorkspaceDetail[] }) {
  const items = [...props.owned]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, 3);
  return (
    <div class="card p-5">
      <h2 class={SECTION_HEAD}>Recent activity</h2>
      {items.length === 0 ? (
        <p class="mt-3 text-sm text-ink-500 italic">No activity yet.</p>
      ) : (
        <ul class="mt-3 space-y-3.5">
          {items.map((w, i) => (
            <li class="flex items-start gap-3">
              <span class={`mt-1 h-2 w-2 shrink-0 rounded-full ${["bg-coral-500", "bg-sun-500", "bg-leaf-500"][i] || "bg-brand-500"}`}></span>
              <div class="min-w-0">
                <div class="text-sm text-ink dark:text-white font-medium leading-snug">{w.name} updated</div>
                <div class="text-xs text-ink-500 mt-0.5">{w.updatedAt ? relativeTime(w.updatedAt) : "—"}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "client";
}

/** The picker body (header + list), used by the standalone full page
 *  (workspacesStandaloneView). */
async function renderPickerBody(user: User) {
  return (
    <div class="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-start justify-between mb-6">
        <div class="min-w-0">
          <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">{WORKSPACE_LABEL_PLURAL}</h1>
          <p class="text-sm text-ink-500">
            Open a workspace, create a new one, or load a .wfp from disk.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-4">
          <button
            hx-get="/app/workspaces/modal/new"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New
          </button>
          <label class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 border border-ink/[0.1] dark:border-white/[0.1] hover:border-brand-400 dark:hover:border-brand-500 rounded-lg transition-colors flex items-center gap-2 cursor-pointer">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            From Disk
            <input
              type="file"
              name="file"
              accept=".wfp,application/json"
              class="hidden"
              hx-post="/app/workspaces/disk/upload"
              hx-encoding="multipart/form-data"
              hx-trigger="change"
              hx-target="#modal-container"
              hx-swap="innerHTML"
            />
          </label>
        </div>
      </div>

      <div id="workspace-list">{await renderWorkspacesTable(user)}</div>
    </div>
  );
}

/** The Clients tab partial for the firm zone — full company-level page that
 *  matches MOCKUP_V5/company_level.html. Renders into #firm-panel. */
export const firmClientsView = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(await renderCompanyHome(user));
};

/** Rotate a client's inbound email secret. Keeps the address key, replaces the
 *  secret, then re-renders the company page so the new address is visible. */
export const workspaceEmailRotate = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  try {
    const addr = await getInboundAddressByWorkspace(workspaceId);
    if (addr) await rotateSecret(addr.address_key);
  } catch (err) {
    console.error("[workspaces] email rotate failed:", err);
  }
  return c.html(await renderCompanyHome(user));
};

/** Standalone picker page (GET /app/workspaces) — its own route, minimal chrome,
 *  no ?panel= indirection. Reachable without an open workspace (the picker is
 *  where you choose one), so it renders a full document rather than a partial. */
export const workspacesStandaloneView = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(
    <html lang="en" class={user.darkMode ? "dark" : ""}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{WORKSPACE_LABEL_PLURAL} — {SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <link rel="stylesheet" href="/public/css/home.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="/public/js/modalHelpers.js"></script>
        <script src="/public/js/cardMenu.js"></script>
        <script src="/public/js/workspaceSecret.js"></script>
      </head>
      <body
        class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <header class="flex items-center justify-between h-12 px-4 md:px-6 border-b border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900">
          <a href="/app" class="inline-flex items-center gap-2 no-underline">
            <Mark size={22} />
            <span class="text-sm font-bold tracking-wide text-ink dark:text-white">
              {SERVER_NAME}
            </span>
          </a>
          <div class="flex items-center gap-3">
            <a
              href="/app/account"
              class="flex items-center gap-2 rounded-xl border border-ink/[0.09] bg-[#F3F5F9] pl-1.5 pr-2.5 py-1 dark:bg-ink-800 dark:border-white/[0.09] no-underline cursor-pointer hover:border-ink/[0.18] dark:hover:border-white/[0.18] transition-colors"
              title={`Signed in as ${user.userEmail}`}
            >
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white text-[11px] font-bold">
                {initials(user.userName?.trim() || user.userEmail || "User")}
              </span>
              <span class="hidden sm:block text-sm font-semibold text-ink dark:text-white">
                {user.userName?.trim() || user.userEmail || "User"}
              </span>
            </a>
            {EDITION !== "local" && (
              <a
                href="/auth/logout"
                class="inline-flex items-center gap-1.5 text-sm text-ink-600 dark:text-white/70 hover:text-ink dark:hover:text-white no-underline"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                </svg>
                Log out
              </a>
            )}
          </div>
        </header>

        <main>{await renderPickerBody(user)}</main>

        {/* Modal container for HTMX swaps (matches the app shells) */}
        <div
          id="modal-container"
          class="fixed inset-0 z-50 hidden"
          hx-on--after-swap="this.classList.remove('hidden')"
          hx-on--before-swap="if(event.detail.xhr.responseText === '') this.classList.add('hidden')"
        ></div>
      </body>
    </html>,
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}k`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

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

/** A row action icon (always enabled — these act on the row's own workspace). */
function actionIcon(opts: { href?: string; hx?: Record<string, string>; title: string; danger?: boolean; svg: any }) {
  const base = "p-1.5 rounded inline-flex items-center justify-center";
  const cls = opts.danger
    ? `${base} text-ink-400 dark:text-ink-500 hover:text-coral-600 dark:hover:text-coral-400 hover:bg-coral-50 dark:hover:bg-coral-900/30`
    : `${base} text-ink-400 dark:text-ink-500 hover:text-ink-600 dark:hover:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04]`;
  if (opts.href) return <a href={opts.href} class={cls} title={opts.title}>{opts.svg}</a>;
  return <button {...(opts.hx || {})} class={cls} title={opts.title}>{opts.svg}</button>;
}

const DEL_SVG = <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>;

// Three vertical dots (⋯) — the card-menu trigger. Matches the design-system
// `MenuIcon` so the visual is identical on /app/workspaces and /design-system.
function MenuDots() {
  return (
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      <circle cx="12" cy="5" r="1.25" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.25" fill="currentColor"/>
      <circle cx="12" cy="19" r="1.25" fill="currentColor"/>
    </svg>
  );
}

// 4×4 lucide-style icon used inside menu rows.
function MenuItemIcon(props: { path: string }) {
  return (
    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <path d={props.path}/>
    </svg>
  );
}

// Lucide-style paths reused on the company page (right rail + pills).
const ICON_ARROW_RIGHT = "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3";const ICON_PLUS = "M12 4.5v15m7.5-7.5h-15";
const ICON_UPLOAD = "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3";
const ICON_CLOCK = "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const ICON_BADGE_CHECK = "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const ICON_X_CIRCLE = "M15 9l-6 6M9 9l6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const ICON_FLAGGED = "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15";
const ICON_DOT_CIRCLE = "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const ICON_SPARKLE = "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z";
const ICON_WORKFLOWS = "M4 6h12M4 12h12M4 18h12";

// Small inline icon (defaults to 14px, currentColor stroke).
function PillIcon(props: { path: string; size?: number }) {
  const size = props.size ?? 13;
  return (
    <svg class="shrink-0" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={props.path}/>
    </svg>
  );
}

/** Workspaces picker body: your workspaces (compact rows, Open + Delete), then
 *  the folded-in Shared page (shared with you · shared by you). */
export async function renderWorkspacesTable(user: User) {
  let owned: WorkspaceDetail[] = [];
  try {
    owned = await listWorkspacesDetailed(user.userId);
  } catch (err) {
    console.warn("[workspaces] list lookup failed:", err);
  }

  if (owned.length === 0) {
    return (
      <div class="bg-white dark:bg-ink-900 border border-dashed border-ink/[0.12] dark:border-white/[0.1] rounded-xl px-6 py-16 text-center">
        <p class="text-sm text-ink-600 dark:text-white/70 mb-1">No workspaces yet.</p>
        <p class="text-xs text-ink-400 dark:text-ink-500">Create one with New, or load a .wfp from disk.</p>
      </div>
    );
  }

  return (
    <div class="space-y-8">
      {/* Your workspaces */}
      <section>
        <div class="flex items-center justify-between mb-3">
          <h2 class={SECTION_HEAD}>Workspaces</h2>
          <span class="text-xs font-semibold text-ink-400">{owned.length} {owned.length === 1 ? "workspace" : "workspaces"}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {owned.map((w, i) => renderClientCard(w, i))}
        </div>
      </section>
    </div>
  );
}

/** An owned-workspace card — identity loudest (avatar + name), then actions
 *  in a vertical-ellipsis dropdown (Open · Edit details · Users · Email ·
 *  Delete). Handler lives in `public/js/cardMenu.js`. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
const AVATAR_BG = ["bg-brand-500", "bg-grape-500", "bg-leaf-500", "bg-pump-500", "bg-sun-500"];

const WORKFLOW_PILL_COLORS = [
  "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300",
  "bg-grape-50 text-grape-500 dark:bg-grape-900/40 dark:text-grape-300",
  "bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300",
  "bg-pump-50 text-pump-600 dark:bg-pump-900/40 dark:text-pump-300",
  "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300",
  "bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300",
];

// Lucide-style paths reused across menu items.
const ICON_OPEN = "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3";
const ICON_SHARE = "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.59 13.51l6.83 3.98M15.41 10.51l-6.82 3.98";
const ICON_DELETE = "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0";
const ICON_EDIT = "M16.862 4.487 18.549 2.8a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.862 4.487Zm0 0L19.5 7.125";
const ICON_MAIL_IN = "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75";
const ICON_MAIL_OUT = "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5";
const ICON_COPY = "M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M6 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z";
const ICON_ROTATE = "M3 12a9 9 0 1 0 2.64-6.36L3 8m0-5v5h5";

/** An owned-workspace card — whole card is clickable (avatar + name + meta
 *  + arrow), with a vertical-ellipsis dropdown for actions (Open · Edit
 *  details · Users · Email · Delete). The link overlay covers the card; the
 *  visible content is `pointer-events: none` so clicks fall through to the
 *  overlay. The ⋯ button + dropdown menu are `pointer-events: auto` so they
 *  stay interactive. */
function renderClientCard(w: WorkspaceDetail, idx: number, workflows: WorkflowIndexEntry[] = [], access?: WorkspaceAccess) {
  const id = w.workspaceId;
  const avatar = AVATAR_BG[idx % AVATAR_BG.length];
  const menuId = `menu-${id}`;
  const inboxAddress = access?.inboxAddress ?? "";
  const hasEmail = inboxAddress.length > 0;
  // Plaintext opens directly; encrypted prompts for the secret first.
  const openHref = w.encrypted
    ? `/app/workspaces/${id}/modal/open`
    : `/app/workspaces/${id}/open`;
  const openAttrs = w.encrypted
    ? { "hx-get": openHref, "hx-target": "#modal-container", "hx-swap": "innerHTML" }
    : { href: openHref };
  const baseItemCls = "flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left rounded-lg transition";
  const normalItemCls = `${baseItemCls} text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06]`;
  const dangerItemCls = `${baseItemCls} text-coral-600 hover:bg-coral-50 dark:text-coral-300 dark:hover:bg-coral-900/30`;

  return (
    <div class="card relative p-5 hover:shadow-md transition-shadow">
      <a
        {...openAttrs}
        aria-label={`Open ${w.name}`}
        class="absolute inset-0 z-0"
      ></a>
      <div class="pointer-events-none relative flex items-start gap-4">
        <div
          class={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${avatar} text-white text-lg font-extrabold`}
        >
          {initials(w.name)}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-bold text-ink dark:text-white truncate">{w.name}</h3>
          {w.description && (
            <div class="text-xs text-ink-500 mt-0.5 truncate">{w.description}</div>
          )}
        </div>
      </div>

      {workflows.length > 0 && (
        <div class="mt-4 flex items-center gap-2 flex-wrap">
          {workflows.slice(0, 6).map((wf, wi) => (
            <span class={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${WORKFLOW_PILL_COLORS[wi % WORKFLOW_PILL_COLORS.length]}`}>
              <PillIcon path={ICON_WORKFLOWS} size={13} />
              {wf.name}
            </span>
          ))}
          {workflows.length > 6 && (
            <span class="text-xs font-semibold text-ink-400">+{workflows.length - 6} more</span>
          )}
        </div>
      )}

      <button
        type="button"
        aria-label={`Actions for ${w.name}`}
        aria-haspopup="menu"
        aria-expanded="false"
        data-card-menu-btn={menuId}
        class="pointer-events-auto absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:text-ink hover:bg-ink/[0.05] dark:hover:bg-white/[0.06] dark:hover:text-white transition"
      >
        <MenuDots />
      </button>

      <div
        id={menuId}
        data-card-menu
        role="menu"
        class="hidden pointer-events-auto absolute right-3 top-12 z-20 w-52 rounded-xl border border-ink/[0.08] bg-white p-1 shadow-lg shadow-ink/[0.08] dark:bg-ink-800 dark:border-white/[0.08] dark:shadow-black/30"
      >
        <a
          data-card-menu-item
          role="menuitem"
          {...openAttrs}
          class={`${normalItemCls} no-underline`}
        >
          <MenuItemIcon path={ICON_OPEN} />
          Open
        </a>
        <a
          data-card-menu-item
          role="menuitem"
          hx-get={`/app/workspaces/${id}/details`}
          hx-target="#modal-container"
          hx-swap="innerHTML"
          class={`${normalItemCls} no-underline`}
        >
          <MenuItemIcon path={ICON_EDIT} />
          Edit details
        </a>
        {!w.encrypted && (
          <a
            data-card-menu-item
            role="menuitem"
            hx-get={`/app/workspaces/${id}/share`}
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class={`${normalItemCls} no-underline`}
          >
            <MenuItemIcon path={ICON_SHARE} />
            Users
          </a>
        )}
        <div class="relative">
          <button
            type="button"
            data-submenu-toggle
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded="false"
            class={`${normalItemCls}`}
          >
            <MenuItemIcon path={ICON_MAIL_IN} />
            Email
            <svg class="w-4 h-4 shrink-0 ml-auto text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <div
            data-card-submenu
            role="menu"
            class="hidden pointer-events-auto absolute right-full top-0 mr-1 w-52 rounded-xl border border-ink/[0.08] bg-white p-1 shadow-lg shadow-ink/[0.08] dark:bg-ink-800 dark:border-white/[0.08] dark:shadow-black/30"
          >
            {hasEmail && (
              <button
                type="button"
                data-copy-email={inboxAddress}
                class={`${normalItemCls}`}
              >
                <MenuItemIcon path={ICON_COPY} />
                <span data-copy-label>Copy email</span>
              </button>
            )}
            {hasEmail && (
              <button
                type="button"
                data-card-menu-item
                role="menuitem"
                hx-post={`/app/workspaces/${id}/email/rotate`}
                hx-confirm="Rotate the inbox email address? The old address stops working immediately."
                hx-target="#firm-panel"
                hx-swap="innerHTML"
                class={`${normalItemCls}`}
              >
                <MenuItemIcon path={ICON_ROTATE} />
                Rotate email
              </button>
            )}
            <a
              data-card-menu-item
              role="menuitem"
              hx-get={`/app/workspaces/${id}/access/inbound`}
              hx-target="#modal-container"
              hx-swap="innerHTML"
              class={`${normalItemCls} no-underline`}
            >
              <MenuItemIcon path={ICON_MAIL_IN} />
              Inbound email
            </a>
            <a
              data-card-menu-item
              role="menuitem"
              hx-get={`/app/workspaces/${id}/access/outbound`}
              hx-target="#modal-container"
              hx-swap="innerHTML"
              class={`${normalItemCls} no-underline`}
            >
              <MenuItemIcon path={ICON_MAIL_OUT} />
              Outbound email
            </a>
          </div>
        </div>
        <div class="my-1 border-t border-ink/[0.07] dark:border-white/[0.07]"></div>
        <a
          data-card-menu-item
          role="menuitem"
          hx-get={`/app/workspaces/${id}/modal/delete`}
          hx-target="#modal-container"
          hx-swap="innerHTML"
          class={`${dangerItemCls} no-underline`}
        >
          <MenuItemIcon path={ICON_DELETE} />
          Delete
        </a>
      </div>
    </div>
  );
}

/** A workspace shared with you: name + owner + Open. */
function renderIncomingRow(g: GrantRow) {
  return (
    <div class="flex items-center justify-between gap-3 rounded-lg border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-3 py-2">
      <div class="min-w-0">
        <div class="font-medium text-ink dark:text-white truncate">
          {g.workflow_name} <span class="font-normal text-ink-400">— from {g.owner_email}</span>
        </div>
        <div class="text-[11px] text-ink-400">
          {g.last_accessed_at ? `Last opened ${relativeTime(g.last_accessed_at)}` : "Not opened yet"}
        </div>
      </div>
      <button
        hx-get={`/app/shared-workspace/${g.workspace_id}/open`}
        hx-swap="none"
        class="shrink-0 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-md text-sm font-semibold"
      >
        Open
      </button>
    </div>
  );
}

/** An owned shareable workspace + who it's shared with + Manage (share modal). */
function renderSharingRow(w: WorkspaceDetail, members: GrantRow[]) {
  const id = w.workspaceId;
  return (
    <div class="flex items-center justify-between gap-3 rounded-lg border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-3 py-2">
      <div class="min-w-0">
        <div class="font-medium text-ink dark:text-white truncate">{w.name}</div>
        <div class="text-[11px] text-ink-400 truncate">
          {members.length === 0
            ? "Not shared with anyone yet."
            : `Shared with ${members.map((m) => m.grantee_email).join(", ")}`}
        </div>
      </div>
      <button
        hx-get={`/app/workspaces/${id}/share`}
        hx-target="#modal-container"
        hx-swap="innerHTML"
        class="shrink-0 px-3 py-1.5 text-sm font-medium text-ink-700 dark:text-white/80 border border-ink/[0.1] dark:border-white/[0.1] hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-md"
      >
        Manage
      </button>
    </div>
  );
}

// ── HTMX partial: list refresh ──────────────────────────────────────────────

export const workspacesListPartial = async (c: Context) => {
  const user = c.get("user") as User;
  return c.html(await renderWorkspacesTable(user));
};

// ── Modals: shared shell ───────────────────────────────────────────────────

function ModalShell({
  title,
  children,
  id,
  wide,
}: {
  title: string;
  children: any;
  id: string;
  wide?: boolean;
}) {
  return (
    <div
      id={id}
      class="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
    >
      <div class={`bg-white dark:bg-ink-900 rounded-xl shadow-xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`}>
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink/[0.08] dark:border-white/[0.08]">
          <h2 class="text-base font-semibold text-ink dark:text-white">{title}</h2>
          <button
            id={`cancel-${id}`}
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div class="mb-3 p-3 text-sm bg-coral-50 dark:bg-coral-900/30 text-coral-600 dark:text-coral-300 border border-coral-200 dark:border-coral-800 rounded-lg">
      {message}
    </div>
  );
}

// ── New workspace modal ────────────────────────────────────────────────────

export const newWorkspaceModal = async (c: Context) => {
  const inputCls =
    "w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500";
  return c.html(
    <ModalShell title="New workspace" id="new-workspace-modal">
      <form hx-post="/app/workspaces/new" hx-target="this" hx-swap="outerHTML" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Workspace name
          </label>
          <input type="text" name="name" required autofocus class={inputCls} placeholder="e.g. Team Budget" />
        </div>

        <div class="space-y-2">
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Secret word
          </label>
          <div id="new-ws-secret" class="space-y-2">
            <input type="password" name="secret" minlength={4} autocomplete="new-password" class={inputCls} placeholder="Secret word (min 4 chars)" />
            <input type="password" name="secret_confirm" minlength={4} autocomplete="new-password" class={inputCls} placeholder="Confirm secret word" />
            <input type="text" name="secret_hint" class={inputCls} placeholder="Hint (optional) — abstract, not the secret" />
            <p class="text-[11px] text-sun-600 dark:text-sun-300">
              Your secret cannot be recovered. Write it down — if you lose it the workspace is lost.
            </p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            id="cancel-new-workspace-modal-2"
            class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg"
          >
            Cancel
          </button>
          <button type="submit" class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">
            Create &amp; open
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const newWorkspaceSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();

  if (!name) return c.html(<ErrorBanner message="Workspace name is required." />);

  const secret = String(form.secret ?? "");
  const confirm = String(form.secret_confirm ?? "");
  if (secret.length < 4) return c.html(<ErrorBanner message="Secret must be at least 4 characters." />);
  if (secret !== confirm) return c.html(<ErrorBanner message="The two secret entries do not match." />);
  const hint = String(form.secret_hint ?? "").trim() || null;

  try {
    await createAndOpenWorkspace({
      userId: user.userId,
      databaseId: user.currentDatabaseId,
      name,
      secret,
      secretHint: hint,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create workspace.";
    return c.html(<ErrorBanner message={msg} />);
  }

  // Land in the new workspace's shell (createAndOpen made a hosted row, so the
  // active session origin carries its id).
  c.header("HX-Redirect", activeShellUrl(user));
  return c.body(null);
};

// ── Shell entry helpers ─────────────────────────────────────────────────────

/** Redirect that works for both HTMX requests and full-page navigations. */
function redirectTo(c: Context, url: string) {
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Redirect", url);
    return c.body(null);
  }
  return c.redirect(url);
}

function shellUrl(_workspaceId: string, _user?: User): string {
  return "/app/chat";
}

/** Shell URL for the user's currently-active session, or the picker if the
 *  active session isn't a hosted (supabase) workspace yet (e.g. blank/memory). */
function activeShellUrl(user: User): string {
  const s = getWorkspaceSession(user.userId);
  const o = s ? getSessionOrigin(s) : undefined;
  return o?.kind === "supabase" ? shellUrl(o.workspaceId, user) : "/app";
}

/** Full-page secret prompt for opening an encrypted (private) workspace via a
 *  direct URL — the workspaceGuard redirects here with ?return=. The HTMX modal
 *  variant (openWorkspaceModal) is used for opens from the list. A plain POST
 *  form (not HTMX) so a full navigation lands back in the shell. */
function UnlockPage({ workspaceId, name, hint, returnTo, darkMode, error, action, submitLabel, intro }: {
  workspaceId: string; name: string; hint?: string | null; returnTo: string; darkMode?: boolean; error?: string;
  action?: string; submitLabel?: string; intro?: string;
}) {
  const formAction = action ?? `/app/workspaces/${workspaceId}/open`;
  return (
    <html lang="en" class={darkMode ? "dark" : ""}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Unlock {name} — Workflow People</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <script src="/public/js/workspaceSecret.js"></script>
      </head>
      <body
        class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen flex items-center justify-center text-ink dark:text-white"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <div class="w-full max-w-sm bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl p-6 shadow-sm mx-4">
          <h1 class="text-lg font-bold mb-1">Unlock “{name}”</h1>
          <p class="text-sm text-ink-500 mb-4">
            {intro ?? "This workspace is private. Enter its secret word to open it."}
          </p>
          {error && <div class="mb-3 text-sm text-coral-600 dark:text-coral-300">{error}</div>}
          <form method="post" action={formAction} class="space-y-3" autocomplete="off">
            <input type="hidden" name="return" value={returnTo} />
            <input
              type="password"
              name="secret"
              required
              autofocus
              autocomplete="off"
              data-wfp-secret-autofill
              placeholder="Secret word"
              class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {hint && <p class="text-xs text-ink-500">Hint: {hint}</p>}
            <div class="flex items-center justify-end gap-2 pt-1">
              <a
                href="/app/workspaces"
                class="px-4 py-2 text-sm text-ink-600 dark:text-white/70 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg no-underline"
              >
                Cancel
              </a>
              <button type="submit" class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">
                {submitLabel ?? "Open"}
              </button>
            </div>
          </form>
        </div>
      </body>
    </html>
  );
}

// ── Open workspace modal (password prompt) ─────────────────────────────────

export const openWorkspaceModal = async (c: Context) => {
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta) {
    return c.html(
      <ModalShell title="Workspace not found" id="open-workspace-modal">
        <ErrorBanner message="This workspace no longer exists." />
      </ModalShell>,
    );
  }
  return c.html(
    <ModalShell title={`Open "${meta.name}"`} id="open-workspace-modal">
      <form
        hx-post={`/app/workspaces/${workspaceId}/open`}
        hx-target="this"
        hx-swap="outerHTML"
        class="space-y-4"
        autocomplete="off"
      >
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Workspace
          </label>
          <input
            type="text"
            value={meta.name}
            readonly
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-ink/[0.03] dark:bg-white/[0.03] text-ink-500 rounded-lg focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Secret word
          </label>
          <input
            type="password"
            name="secret"
            required
            autofocus
            autocomplete="off"
            data-wfp-secret-autofill
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {meta.secretHint && (
            <p class="text-xs text-ink-500 mt-1.5">
              Hint: {meta.secretHint}
            </p>
          )}
        </div>

        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            id="cancel-open-workspace-modal-2"
            class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl"
          >
            Open
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const openWorkspaceSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const form = await c.req.parseBody();
  const secret = String(form.secret ?? "");
  const returnTo = String(form.return ?? "") || shellUrl(workspaceId, user);
  const isHx = c.req.header("HX-Request") === "true";

  try {
    await openSupabaseWorkspace({
      userId: user.userId,
      databaseId: user.currentDatabaseId,
      workspaceId,
      secret,
    });
  } catch (err) {
    const message =
      err instanceof WorkspaceOpenError
        ? err.kind === "wrong_secret"
          ? "Incorrect secret. Try again."
          : err.kind === "not_found"
            ? "This workspace no longer exists."
            : err.message
        : err instanceof Error
          ? err.message
          : "Failed to open workspace.";
    // HTMX modal → inline banner; full-page unlock → re-render the page with error.
    if (isHx) return c.html(<ErrorBanner message={message} />);
    const meta = await getWorkspaceMeta(workspaceId);
    return c.html(
      <UnlockPage
        workspaceId={workspaceId}
        name={meta?.name ?? "Workspace"}
        hint={meta?.secretHint}
        returnTo={returnTo}
        darkMode={user.darkMode}
        error={message}
      />,
    );
  }

  // Land in the workspace shell (or the explicit return target).
  return redirectTo(c, returnTo);
};

// ── Delete confirmation ─────────────────────────────────────────────────────

export const deleteWorkspaceModal = async (c: Context) => {
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta) {
    return c.html(
      <ModalShell title="Workspace not found" id="delete-workspace-modal">
        <ErrorBanner message="This workspace no longer exists." />
      </ModalShell>,
    );
  }
  return c.html(
    <ModalShell title="Delete workspace" id="delete-workspace-modal">
      <p class="text-sm text-ink-700 dark:text-white/80 mb-3">
        Permanently delete <strong>{meta.name}</strong>?
      </p>
      <p class="text-sm text-ink-500 mb-4">
        The encrypted blob is removed from your account. This cannot be undone.
      </p>
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          id="cancel-delete-workspace-modal-2"
          class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg"
        >
          Cancel
        </button>
        <button
          hx-delete={`/app/workspaces/${workspaceId}`}
          hx-target="#workspace-list"
          hx-swap="innerHTML"
          hx-on--after-request="document.getElementById('modal-container').innerHTML = ''; document.getElementById('modal-container').classList.add('hidden');"
          class="px-4 py-2 text-sm font-medium text-white bg-coral-500 hover:bg-coral-600 rounded-lg"
        >
          Delete
        </button>
      </div>
    </ModalShell>,
  );
};

export const deleteWorkspaceSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");

  // If the workspace being deleted is the one currently open, close the session.
  const session = getWorkspaceSession(user.userId);
  const origin = session ? getSessionOrigin(session) : undefined;
  if (origin?.kind === "supabase" && origin.workspaceId === workspaceId) {
    await closeActiveWorkspace(user.userId, "manual");
  }

  await deleteWorkspace(workspaceId);
  return c.html(await renderWorkspacesTable(user));
};

// ── Disk upload flow ───────────────────────────────────────────────────────

export const diskUploadHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const raw = form.file;
  const file = Array.isArray(raw) ? raw[0] : raw;

  console.log(
    `[diskUploadHandler] user=${user.userId} databaseId=${user.currentDatabaseId} formKeys=${Object.keys(form).join(",")} fileType=${typeof file}`,
  );

  if (!file || typeof file === "string") {
    console.warn("[diskUploadHandler] no file in form");
    return c.html(
      <ModalShell title="Open from disk" id="disk-open-modal">
        <ErrorBanner message="No file selected." />
      </ModalShell>,
    );
  }

  const content = await (file as File).text();
  const filename = (file as File).name || "workspace.wfp";
  console.log(
    `[diskUploadHandler] filename=${filename} bytes=${content.length} encrypted=${isEncryptedEnvelope(content)}`,
  );

  // If the file is plaintext, open immediately.
  if (!isEncryptedEnvelope(content)) {
    try {
      const session = await openDiskWorkspace({
        userId: user.userId,
        databaseId: user.currentDatabaseId,
        fileContent: content,
        sourceFilename: filename,
      });
      console.log(
        `[diskUploadHandler] opened session: workspace="${session.getWorkspaceName()}" ` +
        `workflows=${session.getWorkflows().length} tools=${session.getTools().length} ` +
        `data=${session.getDataNames().length} knowledge=${session.getKnowledgePacks().length} ` +
        `databaseId=${session.databaseId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to open file.";
      console.error("[diskUploadHandler] openDiskWorkspace threw:", err);
      return c.html(
        <ModalShell title="Open from disk" id="disk-open-modal">
          <ErrorBanner message={msg} />
        </ModalShell>,
      );
    }
    c.header("HX-Redirect", "/app");
    return c.body(null);
  }

  // Encrypted — stash and prompt for passphrase.
  stashUpload(user.userId, content, filename);
  return c.html(
    <ModalShell title={`Unlock ${filename}`} id="disk-open-modal">
      <form
        hx-post="/app/workspaces/disk/decrypt"
        hx-target="this"
        hx-swap="outerHTML"
        class="space-y-4"
      >
        <p class="text-sm text-ink-500">
          This file is encrypted. Enter the secret word used when it was saved.
        </p>
        <input
          type="password"
          name="secret"
          required
          autofocus
          class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            id="cancel-disk-open-modal-2"
            class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl"
          >
            Open
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const diskDecryptHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const secret = String(form.secret ?? "");

  const upload = takeUpload(user.userId);
  if (!upload) {
    return c.html(<ErrorBanner message="Upload expired. Please choose the file again." />);
  }

  try {
    await openDiskWorkspace({
      userId: user.userId,
      databaseId: user.currentDatabaseId,
      fileContent: upload.content,
      passphrase: secret,
      sourceFilename: upload.filename,
    });
  } catch (err) {
    // Re-stash the upload so the user can try again without re-uploading.
    stashUpload(user.userId, upload.content, upload.filename);
    if (err instanceof WorkspaceOpenError && err.kind === "wrong_secret") {
      return c.html(<ErrorBanner message="Incorrect secret. Try again." />);
    }
    return c.html(
      <ErrorBanner message={err instanceof Error ? err.message : "Failed to decrypt."} />,
    );
  }

  c.header("HX-Redirect", "/app");
  return c.body(null);
};

// ── Save / Save As / Close (called from /app) ──────────────────────────────

export const saveActiveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const result = await saveActiveWorkspace(user.userId, user.currentDatabaseId);

  if (result.kind === "saved") {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return c.html(
      <div class="mt-3 px-3 py-2 text-sm bg-leaf-50 dark:bg-leaf-900/20 text-leaf-700 dark:text-leaf-300 border border-leaf-200 dark:border-leaf-800 rounded-lg inline-flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <span>Saved to your account at {time}.</span>
      </div>,
    );
  }
  if (result.kind === "not_supabase_backed") {
    // Disk-ephemeral session — show inline notice + link to Save As. The
    // user can click the link to open the Save As modal (it returns HTML
    // into #modal-container).
    return c.html(
      <div class="mt-3 px-3 py-2 text-sm bg-sun-50 dark:bg-sun-900/20 text-sun-700 dark:text-sun-300 border border-sun-200 dark:border-sun-800 rounded-lg flex items-center justify-between gap-3">
        <span>
          This workspace was opened from disk and isn't saved to your account yet.
        </span>
        <button
          hx-get="/app/workspaces/modal/save-as"
          hx-target="#modal-container"
          hx-swap="innerHTML"
          class="px-3 py-1 text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded"
        >
          Save As…
        </button>
      </div>,
    );
  }
  return c.html(
    <div class="mt-3 px-3 py-2 text-sm bg-coral-50 dark:bg-coral-900/30 text-coral-600 dark:text-coral-300 border border-coral-200 dark:border-coral-800 rounded-lg">
      No workspace is open.
    </div>,
  );
};

export const saveAsModal = async (c: Context) => {
  const user = c.get("user") as User;
  const session = getWorkspaceSession(user.userId);
  const defaultName = session?.getWorkspaceName() ?? "My workspace";
  return c.html(
    <ModalShell title="Save as new workspace" id="save-as-modal">
      <form
        hx-post="/app/workspaces/save-as"
        hx-target="this"
        hx-swap="outerHTML"
        class="space-y-4"
      >
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Workspace name
          </label>
          <input
            type="text"
            name="name"
            required
            value={defaultName}
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Secret word
          </label>
          <input
            type="password"
            name="secret"
            required
            minlength={4}
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Confirm secret word
          </label>
          <input
            type="password"
            name="secret_confirm"
            required
            minlength={4}
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">
            Hint <span class="font-normal text-ink-400">(optional)</span>
          </label>
          <input
            type="text"
            name="secret_hint"
            class="w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div class="p-3 bg-sun-50 dark:bg-sun-900/20 border border-sun-200 dark:border-sun-800 rounded-lg text-sm text-sun-700 dark:text-sun-300">
          <strong>Your secret cannot be recovered.</strong> Write it down.
        </div>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            id="cancel-save-as-modal-2"
            class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl"
          >
            Save
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const saveAsSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const secret = String(form.secret ?? "");
  const confirm = String(form.secret_confirm ?? "");
  const hint = String(form.secret_hint ?? "").trim() || null;

  if (!name) return c.html(<ErrorBanner message="Name is required." />);
  if (secret.length < 4)
    return c.html(<ErrorBanner message="Secret must be at least 4 characters." />);
  if (secret !== confirm)
    return c.html(<ErrorBanner message="Secrets do not match." />);

  try {
    await saveAsNewWorkspace({
      userId: user.userId,
      databaseId: user.currentDatabaseId,
      name,
      secret,
      secretHint: hint,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save.";
    return c.html(<ErrorBanner message={msg} />);
  }

  c.header("HX-Redirect", "/app");
  return c.body(null);
};

export const closeActiveHandler = async (c: Context) => {
  const user = c.get("user") as User;
  await closeActiveWorkspace(user.userId, "manual");
  c.header("HX-Redirect", "/app");
  return c.body(null);
};

// ── New (blank, no prompts) ─────────────────────────────────────────────────

export const newBlankHandler = async (c: Context) => {
  const user = c.get("user") as User;
  await createBlankWorkspace({
    userId: user.userId,
    databaseId: user.currentDatabaseId,
  });
  c.header("HX-Redirect", "/app");
  return c.body(null);
};

// ── Save to account (unified Save modal, "account" destination) ─────────────

export const saveToAccountHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const secret = form.secret !== undefined ? String(form.secret) : undefined;
  const newSecretRaw = String(form.new_secret ?? "").trim();
  const newSecret = newSecretRaw.length > 0 ? newSecretRaw : undefined;
  const hint = String(form.secret_hint ?? "").trim() || null;

  if (!name) return c.text("Workspace name is required.", 400);
  if (newSecret !== undefined && newSecret.length < 4) {
    return c.text("A new secret must be at least 4 characters.", 400);
  }

  const result = await saveWorkspaceToAccount({
    userId: user.userId,
    databaseId: user.currentDatabaseId,
    name,
    secret,
    newSecret,
    secretHint: hint,
  });

  if (result.kind === "no_session_open") {
    return c.text("No workspace is open.", 400);
  }
  if (result.kind === "secret_required") {
    return c.text("A secret of at least 4 characters is required to save to your account.", 400);
  }
  return c.text("ok");
};

// ── Workspace list row actions: open / download / settings / modify ─────────

/** Open an owned plaintext workspace directly (no secret prompt). */
export const openOwnedDirectHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const returnTo = c.req.query("return") || shellUrl(workspaceId, user);
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return redirectTo(c, "/app/workspaces");
  }
  // Encrypted (private) workspace reached via a direct URL (e.g. the
  // workspaceGuard) → prompt for the secret on a full page, then return.
  if (await isWorkspaceEncrypted(workspaceId)) {
    return c.html(
      <UnlockPage
        workspaceId={workspaceId}
        name={meta.name}
        hint={meta.secretHint}
        returnTo={returnTo}
        darkMode={user.darkMode}
      />,
    );
  }
  try {
    await openSupabaseWorkspace({
      userId: user.userId,
      databaseId: user.currentDatabaseId,
      workspaceId,
      secret: null,
    });
  } catch (err) {
    if (err instanceof WorkspaceOpenError) {
      return redirectTo(c, "/app/workspaces");
    }
    throw err;
  }
  return redirectTo(c, returnTo);
};

// ── Settings modal: rename + privacy toggle + enterprise todos ────────────────

export const settingsModalView = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return c.html(
      <ModalShell title="Workspace settings" id="settings-modal">
        <ErrorBanner message="This workspace isn't available." />
      </ModalShell>,
    );
  }
  const encrypted = await isWorkspaceEncrypted(workspaceId);
  const inputCls =
    "w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500";

  return c.html(
    <ModalShell title="Workspace settings" id="settings-modal">
      <form hx-post={`/app/workspaces/${workspaceId}/settings`} hx-target="this" hx-swap="outerHTML" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">Name</label>
          <input type="text" name="name" value={meta.name} required class={inputCls} />
        </div>

        <div class="space-y-2">
          <div class="text-sm font-medium text-ink-700 dark:text-white/80">Privacy</div>
          <label class="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="shareable"
              checked={!encrypted}
              class="mt-1"
              hx-on:change={encrypted
                ? "document.getElementById('settings-current-secret').classList.remove('hidden'); document.getElementById('settings-new-secret').classList.add('hidden')"
                : "document.getElementById('settings-current-secret').classList.add('hidden'); document.getElementById('settings-new-secret').classList.add('hidden')"}
            />
            <div>
              <div class="text-sm text-ink dark:text-white">Shareable (plaintext)</div>
              <div class="text-xs text-ink-500">Can be shared with others.</div>
            </div>
          </label>
          <label class="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="private"
              checked={encrypted}
              class="mt-1"
              hx-on:change={!encrypted
                ? "document.getElementById('settings-new-secret').classList.remove('hidden'); document.getElementById('settings-current-secret').classList.add('hidden')"
                : "document.getElementById('settings-new-secret').classList.add('hidden'); document.getElementById('settings-current-secret').classList.add('hidden')"}
            />
            <div>
              <div class="text-sm text-ink dark:text-white">Private (encrypted)</div>
              <div class="text-xs text-ink-500">Only you. Cannot be shared.</div>
            </div>
          </label>

          {/* Shown when switching plaintext → private */}
          <div id="settings-new-secret" class="hidden">
            <input type="password" name="secret" minlength={4} autocomplete="new-password" class={inputCls} placeholder="New secret (min 4 chars)" />
            <p class="text-[11px] text-sun-600 dark:text-sun-300 mt-1">Your secret cannot be recovered. Write it down.</p>
          </div>
          {/* Shown when switching private → shareable */}
          <div id="settings-current-secret" class="hidden">
            <input type="password" name="current_secret" autocomplete="off" class={inputCls} placeholder="Current secret (to remove encryption)" />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button type="button" id="cancel-settings-modal-2" class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg">
            Cancel
          </button>
          <button type="submit" class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">
            Save
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const settingsSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return c.html(<ErrorBanner message="This workspace isn't available." />);
  }

  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const mode = String(form.mode ?? "");
  if (!name) return c.html(<ErrorBanner message="Name is required." />);

  const encrypted = await isWorkspaceEncrypted(workspaceId);

  if (name !== meta.name) {
    try {
      await renameWorkspace(workspaceId, name);
    } catch {
      return c.html(<ErrorBanner message="Rename failed." />);
    }
  }

  if (mode === "private" && !encrypted) {
    const members = await listWorkspaceMembers(workspaceId);
    if (members.length > 0) {
      return c.html(<ErrorBanner message="Remove the people it's shared with before making it private." />);
    }
    const secret = String(form.secret ?? "");
    if (secret.length < 4) return c.html(<ErrorBanner message="Secret must be at least 4 characters." />);
    try {
      await encryptWorkspaceById(user.userId, workspaceId, secret);
    } catch {
      return c.html(<ErrorBanner message="Could not encrypt this workspace." />);
    }
  } else if (mode === "shareable" && encrypted) {
    const secret = String(form.current_secret ?? "");
    try {
      await decryptWorkspaceById(user.userId, workspaceId, secret);
    } catch (err) {
      if (err instanceof WorkspaceOpenError && err.kind === "wrong_secret") {
        return c.html(<ErrorBanner message="Incorrect current secret." />);
      }
      return c.html(<ErrorBanner message="Could not remove encryption." />);
    }
  }

  // Success: close the modal and refresh the list in place (stay on the page).
  c.header("HX-Trigger", "refreshTopBar");
  return c.html(
    <>
      <span id="settings-success-trigger" class="hidden"></span>
      <div id="workspace-list" hx-swap-oob="true">{await renderWorkspacesTable(user)}</div>
    </>,
  );
};

// ── Edit details (name + description) ────────────────────────────────────────

export const workspaceDetailsModal = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return c.html(
      <ModalShell title="Edit details" id="details-modal">
        <ErrorBanner message="This workspace isn't available." />
      </ModalShell>,
    );
  }
  const inputCls =
    "w-full px-3 py-2 border border-ink/[0.12] dark:border-white/[0.1] bg-white dark:bg-ink-800 text-ink dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500";
  return c.html(
    <ModalShell title="Edit details" id="details-modal">
      <form
        hx-post={`/app/workspaces/${workspaceId}/details`}
        hx-target="#workspace-list"
        hx-swap="innerHTML"
        hx-on--after-request="document.getElementById('modal-container').innerHTML = ''; document.getElementById('modal-container').classList.add('hidden');"
        class="space-y-4"
      >
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">Name</label>
          <input type="text" name="name" value={meta.name} required class={inputCls} />
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-700 dark:text-white/80 mb-1">Description</label>
          <textarea name="description" rows={3} class={inputCls} placeholder="e.g. FY2026 Q1 · fund administration">{meta.description ?? ""}</textarea>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" id="cancel-details-modal-2" class="px-4 py-2 text-sm font-medium text-ink-700 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] rounded-lg">
            Cancel
          </button>
          <button type="submit" class="px-4 py-2.5 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">
            Save
          </button>
        </div>
      </form>
    </ModalShell>,
  );
};

export const workspaceDetailsSubmit = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  if (!meta || meta.userId !== user.userId) {
    return c.html(<ErrorBanner message="This workspace isn't available." />);
  }

  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const description = String(form.description ?? "").trim() || null;
  if (!name) return c.html(<ErrorBanner message="Name is required." />);

  await updateWorkspaceMeta(workspaceId, { name, description });

  return c.html(await renderWorkspacesTable(user));
};

// ── Modify (AI/chat): open the workspace, then show the modify modal ─────────

export const modifyWorkspaceHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const workspaceId = c.req.param("id");
  const meta = await getWorkspaceMeta(workspaceId);
  const mine = !!meta && meta.userId === user.userId;
  const member = !mine ? !!(await isWorkspaceMember(workspaceId, user.userId)) : false;

  if (!mine && !member) {
    return c.html(
      <ModalShell title="Modify" id="modify-na-modal">
        <ErrorBanner message="This workspace isn't available." />
      </ModalShell>,
    );
  }

  // If it's already the open/active workspace, just show the modify modal — it's
  // decrypted in the session, so skip the open + encrypted checks.
  const active = getWorkspaceSession(user.userId);
  const activeOrigin = active ? getSessionOrigin(active) : undefined;
  if (activeOrigin?.kind === "supabase" && activeOrigin.workspaceId === workspaceId) {
    return workspaceChatModalView(c);
  }

  if (mine && (await isWorkspaceEncrypted(workspaceId))) {
    return c.html(
      <ModalShell title="Modify" id="modify-na-modal">
        <p class="text-sm text-ink-600 dark:text-white/70">
          This workspace is private. Open it (enter its secret) first, then modify.
        </p>
      </ModalShell>,
    );
  }

  try {
    if (mine) {
      await openSupabaseWorkspace({ userId: user.userId, databaseId: user.currentDatabaseId, workspaceId, secret: null });
    } else {
      await openSharedWorkspace({ userId: user.userId, databaseId: user.currentDatabaseId, workspaceId });
    }
  } catch {
    return c.html(
      <ModalShell title="Modify" id="modify-na-modal">
        <ErrorBanner message="Could not open this workspace." />
      </ModalShell>,
    );
  }

  // The path contains "modify", so workspaceChatModalView renders in modify mode.
  return workspaceChatModalView(c);
};
