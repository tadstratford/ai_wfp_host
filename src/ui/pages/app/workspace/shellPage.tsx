import { Context, type Handler } from "hono";
import type { User } from "@backend/types";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { chatPanelView } from "../chatPanel";
import { sessionViewHandler } from "../sessionView";
import { workspacePageView } from "../workflows/workspacePanel";
import { workflowViewPanel } from "../workflows/workflowView";
import { SERVER_NAME, WORKSPACE_LABEL_PLURAL } from "@backend/core/settings/instanceConfig";
import { Mark } from "@frontend/components/logo";
import { NAV_TOGGLE_KEYS } from "@shared/navItems";
import { EDITION } from "@shared/edition";

interface NavItem { key: string; label: string; href: string; iconSvg?: string; modal?: boolean; }

const HOME_ICON = "M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69zM12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.432z";

const CHAT_ICON = "M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z";

const DATA_ICON = "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125";

const SKILLS_ICON = "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z";

const PRIVACY_ICON = "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z";

const QBO_ICON = "M6.75 3h10.5a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 17.25 21H6.75A2.25 2.25 0 0 1 4.5 18.75V5.25A2.25 2.25 0 0 1 6.75 3Zm.75 4.5h9v1.5h-9V7.5Zm0 3.75h9v1.5h-9v-1.5Zm0 3.75h6v1.5h-6V15Z";

const CLIENT_NAV: NavItem[] = [
  { key: "chat", label: "Chat", href: "/app/chat", iconSvg: CHAT_ICON },
  { key: "overview", label: "Workflows", href: "/app/overview", iconSvg: HOME_ICON },
  { key: "privacy", label: "Privacy Map", href: "/app/privacy", iconSvg: PRIVACY_ICON },
  { key: "rules", label: "Rules", href: "/app/rules", iconSvg: SKILLS_ICON },
  { key: "data", label: "Data", href: "/app/data", iconSvg: DATA_ICON },
];

const NAV_ACTIVE_CLS = "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300";
const NAV_INACTIVE_CLS =
  "text-ink-600 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.06]";

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const color = active ? NAV_ACTIVE_CLS : NAV_INACTIVE_CLS;
  const icon = item.iconSvg && (
    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d={item.iconSvg} />
    </svg>
  );
  if (item.modal) {
    return (
      <button
        hx-get={item.href}
        hx-target="#modal-container"
        hx-swap="innerHTML"
        class={`nav-tab flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer no-underline ${color}`}
      >
        {icon}
        <span class="nav-label truncate">{item.label}</span>
      </button>
    );
  }
  return (
    <a
      hx-get={item.href}
      hx-target="#main-panel"
      hx-swap="innerHTML"
      data-nav-path={item.href}
      class={`nav-tab flex w-full items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer no-underline ${color}`}
    >
      {icon}
      <span class="nav-label truncate">{item.label}</span>
    </a>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function renderShell(
  user: User,
  workspaceId: string,
  activeKey: string,
  initialPartial: string,
) {
  const isDark = user.darkMode;
  const dbId = user.currentDatabaseId;
  const ws = dbId ? getSessionByDatabaseId(dbId) : null;
  const workspaceName = ws?.getWorkspaceName() || user.workspaceName?.trim() || "Workspace";
  const period = ws ? ((ws.getMetadata()?.period as string | undefined) ?? null) : null;

  // Toggleable sections (Workflows, Connections) are hidden
  // unless the user has enabled them in Settings.
  const visible = new Set(user.navVisible ?? []);
  const nav = CLIENT_NAV.filter((i) => {
    if (NAV_TOGGLE_KEYS.includes(i.key)) return visible.has(i.key);
    return true;
  });

  const displayName = user.userName?.trim() || user.userEmail || "User";
  const avatar = initials(displayName);

  return (
    <html lang="en" class={isDark ? "dark" : ""}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{workspaceName} — {SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <link rel="stylesheet" href="/public/css/home.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
        <script src="/public/js/layoutScripts.js"></script>
        <script src="/public/js/chatHelpers.js"></script>
        <script src="/public/js/composer.js"></script>
        <script src="/public/js/modalHelpers.js"></script>
        <script src="/public/js/cardMenu.js"></script>
        <script src="/public/js/dataGrid.js"></script>
        <script src="/public/js/accountingTabs.js"></script>
        <script src="/public/js/workspaceShell.js"></script>
        <script src="/public/js/busy.js"></script>
        <script src="/public/js/inboundTest.js"></script>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .htmx-indicator { opacity: 0; }
          .htmx-request .htmx-indicator { opacity: 1; transition: opacity 200ms ease-in; }
          .ws-shell-body { height: 100vh; height: 100dvh; }
          #ws-nav { width: 16rem; }
          @media (min-width: 768px) {
            #ws-nav.ws-collapsed { width: 4rem; }
            #ws-nav.ws-collapsed .nav-label,
            #ws-nav.ws-collapsed .ws-identity-text { display: none; }
            #ws-nav.ws-collapsed .nav-tab { justify-content: center; padding-left: 0.5rem; padding-right: 0.5rem; }
            #ws-nav.ws-collapsed .ws-identity { justify-content: center; padding-left: 0.5rem; padding-right: 0.5rem; }
          }
        `,
          }}
        />
      </head>
      <body
        class="ws-shell-body bg-[#F3F5F9] dark:bg-[#141A23] overflow-hidden text-ink dark:text-white antialiased"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        hx-ext="sse"
        sse-connect="/app/sse"
      >
        <div class="h-full flex">

          {/* Left sidebar — client identity + section nav */}
          <aside
            id="ws-nav"
            class="fixed inset-y-0 left-0 z-40 flex -translate-x-full flex-col border-r border-ink/[0.07] bg-white dark:bg-ink-900 dark:border-white/[0.07] transition-[width,transform] duration-200 md:static md:translate-x-0"
          >
            <div class="ws-identity flex items-center gap-3 px-4 pt-4 pb-3 border-b border-ink/[0.07] dark:border-white/[0.07] min-w-0">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white text-sm font-bold">{initials(workspaceName)}</span>
              <div class="ws-identity-text min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-lg font-bold leading-tight tracking-tight text-ink dark:text-white truncate">{workspaceName}</h1>
                  {period && (
                    <span class="rounded-full bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:text-brand-300">{period}</span>
                  )}
                </div>
                <a href="/app/workspaces" class="text-xs text-ink-500 dark:text-white/60 hover:text-ink-700 dark:hover:text-white no-underline">
                  {WORKSPACE_LABEL_PLURAL}
                </a>
              </div>
            </div>

            <nav class="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {nav.map((item) => (
                <NavLink item={item} active={item.key === activeKey} />
              ))}
            </nav>
          </aside>

          {/* Mobile drawer backdrop */}
          <div id="ws-nav-backdrop" class="fixed inset-0 z-30 hidden bg-black/40 md:hidden"></div>

          {/* Main column */}
          <div class="flex min-w-0 flex-1 flex-col">

            {/* Firm bar */}
            <header class="shrink-0 border-b border-ink/[0.07] bg-white/85 backdrop-blur dark:bg-ink-900/85 dark:border-white/[0.07]">
              <div class="flex items-center justify-between gap-4 px-4 md:px-6 h-16">
                <div class="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    id="ws-nav-toggle"
                    aria-label="Open navigation"
                    class="md:hidden flex h-9 w-9 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/></svg>
                  </button>
                  <button
                    type="button"
                    id="ws-collapse-btn"
                    aria-label="Toggle sidebar"
                    class="hidden md:flex h-9 w-9 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 4.5h16.5v15H3.75zM9 4.5v15"/></svg>
                  </button>
                  <a href="/app/workspaces" class="inline-flex items-center gap-2 no-underline">
                    <Mark size={28} />
                    <span class="text-[15px] font-bold leading-tight tracking-tight text-ink dark:text-white truncate">
                      {SERVER_NAME}
                    </span>
                  </a>
                  <span id="global-busy" class="hidden inline-flex items-center gap-2 shrink-0 min-w-0" aria-hidden="true">
                    <span class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500 block"></span>
                    <span id="global-busy-label" class="text-xs font-medium text-ink-500 dark:text-white/60 truncate">Working…</span>
                  </span>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    hx-get="/app/modal/download-workspace"
                    hx-target="#modal-container"
                    hx-swap="innerHTML"
                    aria-label="Download .wfp"
                    title="Download .wfp"
                    class="flex h-8 w-8 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                  </button>

                  <button
                    hx-post="/user/toggle-dark-mode"
                    hx-swap="none"
                    hx-on--after-request="document.documentElement.classList.toggle('dark')"
                    aria-label="Toggle dark mode"
                    class="flex h-8 w-8 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition"
                  >
                    <svg class="block dark:hidden w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646Z"/></svg>
                    <svg class="hidden dark:block w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M19.07 4.93l-1.41 1.41"/></svg>
                  </button>

                  <a
                    hx-get="/app/user"
                    hx-target="#main-panel"
                    hx-swap="innerHTML"
                    data-nav-path="/app/user"
                    class="flex items-center gap-2 rounded-xl border border-ink/[0.09] bg-[#F3F5F9] pl-1.5 pr-2.5 py-1 dark:bg-ink-800 dark:border-white/[0.09] no-underline cursor-pointer hover:border-ink/[0.18] dark:hover:border-white/[0.18] transition-colors"
                    title={`Signed in as ${user.userEmail || displayName}`}
                  >
                    <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white text-[11px] font-bold">{avatar}</span>
                    <span class="hidden sm:block text-sm font-semibold text-ink dark:text-white">{displayName}</span>
                  </a>
                  {EDITION !== "local" && (
                    <a
                      href="/auth/logout"
                      aria-label="Log out"
                      title="Log out"
                      class="flex h-8 w-8 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            </header>

            <main
              id="main-panel"
              class="overflow-y-auto overflow-x-hidden flex-1 min-h-0 min-w-0"
              hx-get={initialPartial}
              hx-trigger="load"
              hx-swap="innerHTML"
            >
              <div class="flex items-center justify-center h-96">
                <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-500"></div>
              </div>
            </main>
          </div>
        </div>

        <div
          id="modal-container"
          class="fixed inset-0 z-50 hidden"
          hx-on--after-swap="this.classList.remove('hidden')"
          hx-on--before-swap="if(event.detail.xhr.responseText === '') this.classList.add('hidden')"
        ></div>
      </body>
    </html>
  );
}

export function pushUrl(c: Context): string {
  const url = new URL(c.req.url);
  return url.pathname + url.search;
}

export function shellPage(activeKey: string, handler: Handler, initialPath?: (c: Context) => string): Handler {
  return async (c: Context) => {
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Push-Url", pushUrl(c));
      return handler(c, async () => {});
    }
    const user = c.get("user") as User;
    const dbId = user.currentDatabaseId;
    if (!dbId) return c.redirect("/app/workspaces");
    return c.html(renderShell(user, dbId, activeKey, initialPath ? initialPath(c) : c.req.path));
  };
}

export const workspaceShellLanding = async (c: Context) => {
  return c.redirect("/app/chat");
};

export const workspaceShellChat: Handler = async (c) => {
  const url = new URL(c.req.url);
  const hasSession = url.searchParams.has("session_id") || url.searchParams.has("action");
  if (c.req.header("HX-Request") === "true") {
    c.header("HX-Push-Url", pushUrl(c));
    return hasSession ? sessionViewHandler(c) : chatPanelView(c);
  }
  const user = c.get("user") as User;
  const partial = hasSession ? `/app/session${url.search}` : "/app/chat";
  const dbId = user.currentDatabaseId;
  if (!dbId) return c.redirect("/app/workspaces");
  return c.html(renderShell(user, dbId, "chat", partial));
};
