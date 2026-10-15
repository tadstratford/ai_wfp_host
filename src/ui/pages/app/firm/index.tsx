import { Context, type Handler } from "hono";
import type { User } from "@backend/types";
import { SERVER_NAME, WORKSPACE_LABEL_PLURAL } from "@backend/core/settings/instanceConfig";
import { Mark } from "@frontend/components/logo";
import { loadAppSkills } from "@core/skills/loader";
import {
  listServerInboundAllowlist,
  addToServerInboundAllowlist,
  removeFromServerInboundAllowlist,
  listServerOutboundAllowlist,
  addToServerOutboundAllowlist,
  removeFromServerOutboundAllowlist,
} from "@workspace/emailInbox/serverAllowlist";
import { userManager } from "@backend/core/admin/userManager";
import { secretsListHtml } from "../settingsPanel";

interface FirmNavItem { key: string; label: string; href: string; iconSvg: string; }

const CLIENTS_ICON = "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z";

const SKILLS_ICON = "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z";

const ACCESS_ICON = "M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z";

const SETTINGS_ICON = "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z";

const FIRM_NAV: FirmNavItem[] = [
  { key: "clients", label: WORKSPACE_LABEL_PLURAL, href: "/app/workspaces", iconSvg: CLIENTS_ICON },
  { key: "skills", label: "Firm Skills", href: "/app/workspaces/skills", iconSvg: SKILLS_ICON },
  { key: "access", label: "Access", href: "/app/workspaces/access", iconSvg: ACCESS_ICON },
  { key: "settings", label: "Settings", href: "/app/workspaces/settings", iconSvg: SETTINGS_ICON },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function FirmNavLink({ item, active }: { item: FirmNavItem; active: boolean }) {
  return (
    <a
      hx-get={item.href}
      hx-target="#firm-panel"
      hx-swap="innerHTML"
      hx-push-url={item.href}
      class={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold cursor-pointer no-underline ${
        active
          ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"
          : "text-ink-600 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.06]"
      }`}
    >
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d={item.iconSvg} />
      </svg>
      {item.label}
    </a>
  );
}

export function renderFirmShell(user: User, activeKey: string, initialPartial: string) {
  const isDark = user.darkMode;
  const displayName = user.userName?.trim() || user.userEmail || "User";
  const avatar = initials(displayName);

  return (
    <html lang="en" class={isDark ? "dark" : ""}>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{SERVER_NAME}</title>
        <link rel="stylesheet" href="/public/css/tailwind.css" />
        <link rel="stylesheet" href="/public/css/home.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4"></script>
        <script src="/public/js/modalHelpers.js"></script>
        <script src="/public/js/cardMenu.js"></script>
      </head>
      <body
        class="bg-[#F3F5F9] dark:bg-[#141A23] min-h-screen text-ink dark:text-white antialiased"
        style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      >
        <header class="sticky top-0 z-40 border-b border-ink/[0.07] bg-white/85 backdrop-blur dark:bg-ink-900/85 dark:border-white/[0.07]">
          <div class="flex items-center justify-between gap-4 px-4 md:px-6 h-16">
            <div class="flex items-center gap-3 min-w-0">
              <a href="/app/workspaces" class="inline-flex items-center gap-2 no-underline">
                <Mark size={28} />
                <span class="text-[15px] font-bold leading-tight tracking-tight text-ink dark:text-white truncate">{SERVER_NAME}</span>
              </a>
              <span class="text-[10px] font-semibold uppercase tracking-wider text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-900/30 px-1.5 py-0.5 rounded-full shrink-0">firm</span>
            </div>

            <div class="flex items-center gap-2 shrink-0">
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
                href="/auth/logout"
                class="flex items-center gap-2 rounded-xl border border-ink/[0.09] bg-[#F3F5F9] pl-1.5 pr-2.5 py-1 no-underline hover:bg-ink/[0.04] dark:bg-ink-800 dark:border-white/[0.09] dark:hover:bg-white/[0.04] transition"
                title={`Signed in as ${user.userEmail || displayName}`}
              >
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white text-[11px] font-bold">{avatar}</span>
                <span class="hidden sm:block text-sm font-semibold text-ink dark:text-white">{displayName}</span>
              </a>
            </div>
          </div>
        </header>

        <main
          id="firm-panel"
          hx-get={initialPartial}
          hx-trigger="load"
          hx-swap="innerHTML"
        >
          <div class="flex items-center justify-center h-96">
            <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-500"></div>
          </div>
        </main>

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

export function firmShellPage(activeKey: string, handler: Handler): Handler {
  return async (c: Context) => {
    if (c.req.header("HX-Request") === "true") {
      c.header("HX-Push-Url", c.req.path);
      return handler(c, async () => {});
    }
    const user = c.get("user") as User;
    return c.html(renderFirmShell(user, activeKey, c.req.path));
  };
}

// ── Firm Skills ──────────────────────────────────────────────────────────────

export const firmSkillsView: (c: Context) => Promise<Response> = async (c: Context) => {
  const skills = loadAppSkills();
  return c.html(
    <div class="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <h1 class="text-2xl font-bold text-ink dark:text-white mb-1">Firm Skills</h1>
      <p class="text-sm text-ink-500 mb-6">
        Capabilities your workflows can be built with. Owned by the firm, available to every client.
      </p>

      {skills.length === 0 ? (
        <p class="text-sm text-ink-400 dark:text-ink-500 italic">No firm skills found.</p>
      ) : (
        <div class="space-y-2">
          {skills.map((s) => (
            <div class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-4 py-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold text-ink dark:text-white">{s.name}</span>
                {s.scope && (
                  <span class="text-[11px] font-semibold uppercase tracking-wide text-brand-600 bg-brand-50 dark:text-brand-300 dark:bg-brand-900/40 px-1.5 py-0.5 rounded">{s.scope}</span>
                )}
              </div>
              {s.description && <p class="text-xs text-ink-500 mt-1">{s.description}</p>}
              {s.tags && s.tags.length > 0 && (
                <div class="flex flex-wrap gap-1.5 mt-2">
                  {s.tags.map((t) => (
                    <span class="text-[11px] text-ink-500 dark:text-white/70 bg-ink/[0.05] dark:bg-white/[0.06] px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>,
  );
};

// ── Access (email whitelists — server owner only) ────────────────────────────

function allowlistSection(title: string, hint: string, items: string[], addUrl: string, removeUrl: string) {
  return (
    <section class="mb-8">
      <div class="flex items-baseline justify-between mb-2">
        <h2 class="text-sm font-semibold text-ink-700 dark:text-white/80">{title}</h2>
        <span class="text-xs text-ink-400 dark:text-ink-500">{items.length} {items.length === 1 ? "address" : "addresses"}</span>
      </div>
      <p class="text-xs text-ink-500 mb-3">{hint}</p>

      <div class="space-y-1.5 mb-3">
        {items.length === 0 ? (
          <p class="text-xs text-ink-400 dark:text-ink-500 italic">None yet.</p>
        ) : (
          items.map((email) => (
            <div class="flex items-center justify-between gap-2 rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-white dark:bg-ink-900 px-3 py-1.5">
              <span class="min-w-0 text-sm text-ink-700 dark:text-white/80 font-mono truncate">{email}</span>
              <button
                hx-delete={`${removeUrl}?email=${encodeURIComponent(email)}`}
                hx-target="#server-email"
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

      <form
        hx-post={addUrl}
        hx-target="#server-email"
        hx-swap="innerHTML"
        class="flex items-center gap-2"
      >
        <input
          type="email"
          name="email"
          required
          placeholder="name@example.com"
          class="flex-1 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl px-3 py-2 bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-1 focus:ring-brand-500 transition"
        />
        <button class="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-colors">
          Add
        </button>
      </form>
    </section>
  );
}

export async function serverEmailSections() {
  const [inbound, outbound] = await Promise.all([
    listServerInboundAllowlist().catch(() => [] as string[]),
    listServerOutboundAllowlist().catch(() => [] as string[]),
  ]);
  return (
    <>
      {allowlistSection(
        "Can email in",
        "Senders the firm will accept email from. Leave empty to deny all.",
        inbound,
        "/app/workspaces/access/inbound",
        "/app/workspaces/access/inbound",
      )}
      {allowlistSection(
        "Can be emailed",
        "Recipients the firm may send email to. Leave empty to deny all.",
        outbound,
        "/app/workspaces/access/outbound",
        "/app/workspaces/access/outbound",
      )}
    </>
  );
}

export const firmAccessView: (c: Context) => Promise<Response> = async (c: Context) => {
  return c.html(await serverEmailSections());
};

export const firmAccessAddInbound: (c: Context) => Promise<Response> = async (c: Context) => {
  const body = await c.req.parseBody();
  const email = ((body.email as string) || "").trim();
  if (email) { try { await addToServerInboundAllowlist(email); } catch (e) { console.error("[firmAccess] add inbound failed:", e); } }
  return c.html(await serverEmailSections());
};

export const firmAccessRemoveInbound: (c: Context) => Promise<Response> = async (c: Context) => {
  const email = c.req.query("email") || "";
  if (email) { try { await removeFromServerInboundAllowlist(email); } catch (e) { console.error("[firmAccess] remove inbound failed:", e); } }
  return c.html(await serverEmailSections());
};

export const firmAccessAddOutbound: (c: Context) => Promise<Response> = async (c: Context) => {
  const body = await c.req.parseBody();
  const email = ((body.email as string) || "").trim();
  if (email) { try { await addToServerOutboundAllowlist(email); } catch (e) { console.error("[firmAccess] add outbound failed:", e); } }
  return c.html(await serverEmailSections());
};

export const firmAccessRemoveOutbound: (c: Context) => Promise<Response> = async (c: Context) => {
  const email = c.req.query("email") || "";
  if (email) { try { await removeFromServerOutboundAllowlist(email); } catch (e) { console.error("[firmAccess] remove outbound failed:", e); } }
  return c.html(await serverEmailSections());
};

// ── Settings ─────────────────────────────────────────────────────────────────

export const firmSettingsView: (c: Context) => Promise<Response> = async (c: Context) => {
  const user = c.get("user") as User;
  const isDark = user.darkMode;
  const secrets = await userManager.listSecrets(user.userId);
  const provider = user.llmProvider || "Default";
  const model = user.llmModel || "No model";

  return c.html(
    <div class="max-w-2xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <h1 class="text-2xl font-bold text-ink dark:text-white mb-1">Settings</h1>
      <p class="text-sm text-ink-500 mb-8">Firm display, connections, and the model.</p>

      <section class="mb-10">
        <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">Appearance</h2>
        <div class="flex items-center justify-between bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3">
          <div>
            <div class="text-sm font-medium text-ink dark:text-white">Dark Mode</div>
            <div class="text-xs text-ink-500">Toggle dark/light appearance</div>
          </div>
          <button
            hx-post="/user/toggle-dark-mode"
            hx-swap="none"
            hx-on--after-request="document.documentElement.classList.toggle('dark')"
            class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isDark ? "bg-brand-500" : "bg-ink-300 dark:bg-ink-600"}`}
          >
            <span class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isDark ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </section>

      <section class="mb-10">
        <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">Model</h2>
        <div class="flex items-center justify-between bg-white dark:bg-ink-900 border border-ink/[0.08] dark:border-white/[0.08] rounded-xl px-4 py-3">
          <div>
            <div class="text-sm font-medium text-ink dark:text-white">{provider}</div>
            <div class="text-xs text-ink-500 font-mono">{model}</div>
          </div>
          <button
            hx-get="/app/api/model-picker"
            hx-target="#modal-container"
            hx-swap="innerHTML"
            class="rounded-xl px-3 py-1.5 text-sm font-semibold text-ink-600 dark:text-white/80 border border-ink/[0.1] dark:border-white/[0.1] hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          >
            Change
          </button>
        </div>
      </section>

      <section>
        <h2 class="text-sm font-semibold text-ink-500 uppercase tracking-wider mb-3">Connections</h2>
        <p class="text-xs text-ink-500 mb-4">
          API keys for external services. Used by <code class="bg-ink/[0.05] dark:bg-white/[0.06] px-1 rounded">api.getSecret(name)</code> in workflow tools.
        </p>
        {secretsListHtml(secrets)}
      </section>
    </div>,
  );
};
