import { Hono } from "hono";
import { SERVER_NAME } from "@backend/core/settings/instanceConfig";
import { Mark, Wordmark } from "@frontend/components/logo";
import type { User } from "@backend/types";

export const designRouter = new Hono();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Head() {
  return (
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Design System — {SERVER_NAME}</title>
      <link rel="stylesheet" href="/public/css/tailwind.css" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="/public/css/home.css" />
      <style
        dangerouslySetInnerHTML={{
          __html: `::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(140,160,190,.4); border-radius: 8px; }`,
        }}
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `function applyTheme(d){ document.documentElement.classList.toggle("dark", d); localStorage.setItem("ds-theme", d?"dark":"light"); }
function toggleTheme(){ applyTheme(!document.documentElement.classList.contains("dark")); }
var s = localStorage.getItem("ds-theme");
if (s) applyTheme(s === "dark"); else applyTheme(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);`,
        }}
      />
      <script src="/public/js/cardMenu.js"></script>
    </head>
  );
}

function FirmBar(props: { user?: User }) {
  const user = props.user;
  const displayName = user?.userName?.trim() || user?.userEmail || "Reference";
  const avatar = initials(displayName);
  return (
    <header class="sticky top-0 z-40 border-b border-ink/[0.07] bg-white/85 backdrop-blur dark:bg-ink-900/85 dark:border-white/[0.07]">
      <div class="max-w-[1440px] mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <a href="/design-system" class="flex items-center gap-2.5 no-underline">
            <Mark size={28} />
            <div class="min-w-0">
              <div class="text-[15px] font-bold leading-tight tracking-tight text-ink dark:text-white truncate">{SERVER_NAME}</div>
              <div class="text-[11px] text-ink-500 font-medium leading-none mt-0.5 truncate">design system · reference</div>
            </div>
          </a>
          <span class="text-[10px] font-semibold uppercase tracking-wider text-brand-600 bg-brand-50 dark:text-brand-400 dark:bg-brand-900/30 px-1.5 py-0.5 rounded-full shrink-0">ref</span>
        </div>
        <div class="flex items-center gap-2.5">
          <a href="/design-system/links" class="text-sm font-semibold text-ink-600 dark:text-white/80 hover:text-ink no-underline">Links diagram</a>
          <button onclick="toggleTheme()" aria-label="Toggle dark mode" class="flex h-9 w-9 items-center justify-center rounded-xl border border-ink/[0.09] bg-[#F3F5F9] text-ink-500 hover:text-ink dark:bg-ink-800 dark:border-white/[0.09] dark:text-white dark:hover:text-white transition">
            <svg class="block dark:hidden w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646Z"/></svg>
            <svg class="hidden dark:block w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M19.07 4.93l-1.41 1.41"/></svg>
          </button>
          {user && (
            <span class="flex items-center gap-2 rounded-xl border border-ink/[0.09] bg-[#F3F5F9] px-2.5 py-1.5 dark:bg-ink-800 dark:border-white/[0.09]">
              <span class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white text-xs font-bold">{avatar}</span>
              <span class="hidden sm:block text-sm font-semibold text-ink dark:text-white">{displayName}</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function SectionTitle(props: { n: string; title: string; hint?: string; count?: string }) {
  return (
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wider text-ink-500">{props.title}</span>
        <span class="text-[11px] font-semibold text-ink-400">{props.hint}</span>
      </div>
      {props.count && <span class="text-xs font-semibold text-ink-400">{props.count}</span>}
    </div>
  );
}

const SWATCHES: { name: string; hex: string }[] = [
  { name: "ink", hex: "#242E3D" },
  { name: "ink-800", hex: "#2C3A4D" },
  { name: "ink-600", hex: "#51617A" },
  { name: "ink-500", hex: "#6C7C94" },
  { name: "ink-400", hex: "#93A1B6" },
  { name: "brand-600", hex: "#2B7BCB" },
  { name: "brand-500", hex: "#3E8DE1" },
  { name: "brand-300", hex: "#7FB0EF" },
  { name: "brand-100", hex: "#D5E7FB" },
  { name: "brand-50", hex: "#EAF3FD" },
  { name: "leaf-600", hex: "#488C4C" },
  { name: "leaf-500", hex: "#5CAA60" },
  { name: "leaf-50", hex: "#EDF7EE" },
  { name: "coral-600", hex: "#DC4B4B" },
  { name: "coral-500", hex: "#F06A6A" },
  { name: "sun-500", hex: "#F5A94B" },
  { name: "grape-500", hex: "#8B6BD6" },
  { name: "pump-500", hex: "#16A0A0" },
  { name: "bg-light", hex: "#F3F5F9" },
  { name: "bg-dark", hex: "#141A23" },
];

const MARK_COLORS = ["#2b7bcb", "#5caa60", "#3e8de1", "#40d06a"];

// Lucide-compatible path data (single `d` string per icon, viewBox 0 0 24 24).
// Inlined rather than referencing MOCKUP_V5/icons.js so the design system
// renders standalone without an extra script tag.
const ICON_PATHS: Record<string, string> = {
  running:    "M22 12h-4l-3 9L9 3l-3 9H2",
  complete:   "M20 6 9 17l-5-5",
  stale:      "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  notrun:     "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  flagged:    "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15",
  processed:  "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3",
  skills:     "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  verified:   "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76ZM9 12l2 2 4-4",
  failed:     "M15 9l-6 6M9 9l6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  folder:     "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  add:        "M12 4.5v15m7.5-7.5h-15",
  arrowright: "M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3",
  play:       "M6 4l14 8-14 8z",
  clock:      "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  shield:     "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  person:     "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  thread:     "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  privacy:    "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
  data:       "M3 3h18v18H3zM3 9h18M9 3v18",
  wand:       "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h0M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5",
  home:       "M3 12 12 3l9 9M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10",
};

function Icon(props: { name: string; size?: number; class?: string }) {
  const size = props.size ?? 16;
  return (
    <svg
      class={props.class ?? ""}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[props.name] ?? ""} />
    </svg>
  );
}

interface TreeNode {
  label: string;
  href?: string;
  note?: string;
  children?: TreeNode[];
}

const TREE: TreeNode = {
  label: SERVER_NAME,
  children: [
    { label: "/", href: "/", note: "→ /app" },
    { label: "/auth", href: "/auth/login", note: "login · google · magic-link · logout · qbo" },
    { label: "/inbound", note: "email webhook (public)" },
    { label: "/user", note: "toggle-dark-mode · secrets · llm-keys" },
    { label: "/design-system", href: "/design-system", note: "this page · /links" },
    {
      label: "/app",
      children: [
        {
          label: "/workspaces — firm zone",
          note: "no client session",
          children: [
            { label: "/", href: "/app/workspaces", note: "Clients" },
            { label: "/skills", href: "/app/workspaces/skills", note: "Firm Skills" },
            { label: "/access", href: "/app/workspaces/access", note: "Access (in/out allowlist)" },
            { label: "/settings", href: "/app/workspaces/settings", note: "Settings (dark · model · secrets)" },
            { label: "/:id/*", note: "open · download · share · modify · delete" },
            { label: "/shared-workspace/:id/open", note: "open a share" },
          ],
        },
        {
          label: "client shell — session gated",
          children: [
            { label: "/overview", href: "/app/overview", note: "Home (workflows)" },
            { label: "/chat", href: "/app/chat", note: "Chat" },
            { label: "/privacy", href: "/app/privacy", note: "Privacy Map" },
            { label: "/rules", href: "/app/rules", note: "Rules" },
            { label: "/data", href: "/app/data", note: "Data" },
            { label: "/make-workflow", href: "/app/make-workflow", note: "Make Workflow wizard" },
            { label: "/view/:workflowId", note: "workflow detail" },
            { label: "/session", note: "run view" },
            { label: "/logs/:logId", note: "LLM log" },
            { label: "/api/*", note: "models · model-prefs · model-picker" },
          ],
        },
      ],
    },
    {
      label: "/sessions",
      note: "run/chat internals",
      children: [
        { label: "/start · /view · /todo-start", note: "load a run" },
        { label: "/api/messages · status · buttons · history", note: "chat stream" },
        { label: "/send · /resume · /interact · /feedback", note: "actions" },
      ],
    },
  ],
};

function TreeChildren({ nodes, depth }: { nodes: TreeNode[]; depth: number }) {
  return (
    <div class={depth > 0 ? "ml-5 border-l border-ink/[0.12] dark:border-white/[0.12] pl-4" : ""}>
      {nodes.map((n) => (
        <div class="py-1.5">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="inline-flex items-center gap-2 rounded-md bg-ink/[0.04] dark:bg-white/[0.06] px-2 py-0.5">
              {n.href ? (
                <a href={n.href} class="font-mono text-xs font-semibold text-brand-600 dark:text-brand-300 no-underline hover:underline">{n.label}</a>
              ) : (
                <span class="font-mono text-xs font-semibold text-ink-700 dark:text-white/90">{n.label}</span>
              )}
            </span>
            {n.note && <span class="text-xs text-ink-400">{n.note}</span>}
          </div>
          {n.children && <TreeChildren nodes={n.children} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><circle cx="12" cy="5" r="1.25" fill="currentColor"/><circle cx="12" cy="12" r="1.25" fill="currentColor"/><circle cx="12" cy="19" r="1.25" fill="currentColor"/></svg>
  );
}

function MenuItem(props: { icon: string; label: string; danger?: boolean }) {
  const tint = props.danger
    ? "text-coral-600 hover:bg-coral-50 dark:text-coral-300 dark:hover:bg-coral-900/30"
    : "text-ink-700 hover:bg-ink/[0.04] dark:text-white/90 dark:hover:bg-white/[0.06]";
  return (
    <a href="#" data-card-menu-item role="menuitem" class={`flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium text-left rounded-lg transition no-underline ${tint}`}>
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d={props.icon}/></svg>
      <span>{props.label}</span>
    </a>
  );
}

function BrandTile() {
  return (
    <div class="card p-5">
      <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Wordmark — adapts to bg</div>
      <div class="flex items-center justify-center py-4"><Wordmark size={40} /></div>
    </div>
  );
}

function MarkTile() {
  return (
    <div class="card p-5">
      <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">W mark</div>
      <div class="flex items-center justify-center py-3"><Mark size={48} /></div>
    </div>
  );
}

function MarkColorsTile() {
  return (
    <div class="card p-5">
      <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Mark colors</div>
      <div class="flex gap-2">
        {MARK_COLORS.map((hex) => (
          <div class="text-center">
            <div class="w-12 h-12 rounded-lg border border-ink/[0.08]" style={`background:${hex}`}></div>
            <div class="text-[10px] font-mono text-ink-400 mt-1">{hex}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClientCard(props: { id: string; initials: string; name: string; sub: string; bg: string; pills: { txt: string; cls: string; }[] }) {
  return (
    <div class="card relative p-5 hover:border-ink/[0.14] dark:hover:border-white/[0.14] transition">
      <div class="flex items-start gap-4">
        <a
          href="#"
          aria-label={`Open ${props.name}`}
          class={`ico-box h-12 w-12 ${props.bg} text-white text-lg font-extrabold no-underline hover:opacity-90 transition-opacity`}
          style="border-radius:0.5rem"
        >
          {props.initials}
        </a>
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-bold text-ink dark:text-white truncate">{props.name}</h3>
          <div class="text-xs text-ink-500 mt-0.5">{props.sub}</div>
        </div>
        <button
          type="button"
          aria-label={`Actions for ${props.name}`}
          aria-haspopup="menu"
          aria-expanded="false"
          data-card-menu-btn={props.id}
          class="shrink-0 -mr-1 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:text-ink hover:bg-ink/[0.05] dark:hover:bg-white/[0.06] dark:hover:text-white transition"
        >
          <MenuIcon />
        </button>
      </div>
      <div class="mt-4 flex items-center gap-2 flex-wrap">
        {props.pills.map((p) => (
          <span class={`pill ${p.cls}`}>{p.txt}</span>
        ))}
      </div>
      <div
        id={props.id}
        data-card-menu
        role="menu"
        class="hidden absolute right-3 top-12 z-20 w-52 rounded-xl border border-ink/[0.08] bg-white p-1 shadow-lg shadow-ink/[0.08] dark:bg-ink-800 dark:border-white/[0.08] dark:shadow-black/30"
      >
        <MenuItem icon="M3 12h18M3 6h18M3 18h18" label="Open" />
        <MenuItem icon="M12 3v14m0 0l-4-4m4 4l4-4M5 21h14" label="Download" />
        <MenuItem icon="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.59 13.51l6.83 3.98M15.41 10.51l-6.82 3.98" label="Share" />
        <div class="my-1 border-t border-ink/[0.07] dark:border-white/[0.07]"></div>
        <MenuItem icon="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" label="Delete" danger />
      </div>
    </div>
  );
}

function GroupHeader(props: { iconBg: string; iconClass: string; label: string }) {
  return (
    <div class="flex items-center gap-2 mb-2 px-1">
      <span class={`ico-box h-5 w-5 ${props.iconBg} ${props.iconClass} p-1`}>
        <Icon name="folder" size={12} />
      </span>
      <span class="text-xs font-bold uppercase tracking-wide text-ink-500">{props.label}</span>
    </div>
  );
}

function WorkflowRowCard(props: {
  iconBg: string;
  iconClass: string;
  iconName: string;
  title: string;
  sub: string;
  right: any;
  accentBorder?: string;
}) {
  const borderCls = props.accentBorder ?? "border-ink/[0.08] dark:border-white/[0.08]";
  return (
    <div class={`card p-4 flex items-center gap-4 ${borderCls}`}>
      <span class={`ico-box h-9 w-9 ${props.iconBg} ${props.iconClass} p-2`}>
        <Icon name={props.iconName} size={18} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-ink dark:text-white">{props.title}</div>
        <div class="text-xs text-ink-500 mt-0.5">{props.sub}</div>
      </div>
      {props.right}
    </div>
  );
}

function GlanceCard() {
  return (
    <div class="card p-5">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="text-sm font-bold uppercase tracking-wider text-ink-500">At a glance</h3>
        <span class="text-xs font-semibold text-ink-400">FY2026 Q1</span>
      </div>
      <div class="grid sm:grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-1">Where you are</div>
          <div class="text-sm text-ink-700 dark:text-white/80">5 of 7 workflows done · 1 waiting on you</div>
          <div class="mt-2 h-1.5 rounded-full bg-ink/[0.07] dark:bg-white/[0.08] overflow-hidden">
            <div class="h-full w-[71%] rounded-full bg-brand-500"></div>
          </div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-1">Audit results</div>
          <div class="flex items-center gap-4 text-sm">
            <span class="inline-flex items-center gap-1.5 text-leaf-600 dark:text-leaf-300">
              <Icon name="verified" size={15} />
              46 correct
            </span>
            <span class="inline-flex items-center gap-1.5 text-coral-600 dark:text-coral-300">
              <Icon name="failed" size={15} />
              1 needs review
            </span>
          </div>
        </div>
      </div>
      <div class="mt-4 pt-3 border-t border-ink/[0.06] dark:border-white/[0.06] flex flex-wrap items-center gap-2">
        <span class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Your next move</span>
        <button class="inline-flex items-center gap-2 rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-white">
          Review bank reconciliation
          <Icon name="arrowright" size={14} />
        </button>
      </div>
    </div>
  );
}

function ClientIdentityHeader() {
  return (
    <div class="flex items-center justify-between gap-4 flex-wrap mb-5 rounded-xl border border-dashed border-ink/[0.12] dark:border-white/[0.12] p-4 bg-white/50 dark:bg-ink-800/30">
      <div class="flex items-center gap-3 min-w-0">
        <span class="ico-box h-11 w-11 bg-brand-500 text-white text-base font-extrabold">FF</span>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Franklin Fund</h3>
            <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">FY2026 Q1</span>
          </div>
          <p class="text-xs text-ink-500 mt-0.5">Fund administration</p>
        </div>
      </div>
      <button class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white">
        <Icon name="add" size={16} />
        Make a workflow
      </button>
    </div>
  );
}

designRouter.get("/links", (c) => {
  const user = c.get("user") as User | undefined;
  return c.html(
    <html lang="en" class="">
      <Head />
      <body class="bg-[#F3F5F9] text-ink dark:bg-[#141A23] dark:text-white antialiased transition-colors duration-300">
        <FirmBar user={user} />
        <main class="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
          <div class="flex items-end justify-between gap-4 flex-wrap mb-6">
            <div>
              <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Links Diagram</h1>
              <p class="text-sm text-ink-500 mt-1">The app's routes, top-down.</p>
            </div>
          </div>
          <div class="card p-6">
            <div class="flex items-center gap-2 mb-5">
              <Mark size={24} />
              <span class="font-mono text-xs font-bold text-ink-700 dark:text-white/90">{TREE.label}</span>
            </div>
            {TREE.children && <TreeChildren nodes={TREE.children} depth={0} />}
          </div>
          <div class="mt-6 text-xs text-ink-400">
            Firm zone (<code class="font-mono">/app/workspaces</code>) is reachable without an open client;
            the client shell (<code class="font-mono">/app/overview … /make-workflow</code>) requires an open workspace session.
          </div>
        </main>
      </body>
    </html>,
  );
});

designRouter.get("/", (c) => {
  const user = c.get("user") as User | undefined;
  return c.html(
    <html lang="en" class="">
      <Head />
      <body class="bg-[#F3F5F9] text-ink dark:bg-[#141A23] dark:text-white antialiased transition-colors duration-300">
        <FirmBar user={user} />
        <main class="max-w-[1440px] mx-auto w-full px-4 md:px-8 py-6 md:py-8">
          <div class="flex items-end justify-between gap-4 flex-wrap mb-6">
            <div>
              <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Design System</h1>
              <p class="text-sm text-ink-500 mt-1 max-w-2xl">Single source of truth for logo, color, type, and components. Mirrors <code class="font-mono">MOCKUP_V5/</code>.</p>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8">
            <div class="min-w-0 space-y-8">

              <section>
                <SectionTitle n="1" title="Brand" hint="wordmark + mark" />
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <BrandTile />
                  <MarkTile />
                  <MarkColorsTile />
                </div>
              </section>

              <section>
                <SectionTitle n="2" title="Color" hint="semantic tokens" count={`${SWATCHES.length} swatches`} />
                <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                  {SWATCHES.map((s) => (
                    <div class="card p-2">
                      <div class="h-14 rounded-lg border border-ink/[0.08]" style={`background:${s.hex}`}></div>
                      <div class="px-1 pt-1.5">
                        <div class="text-xs font-semibold text-ink-700 dark:text-white/90">{s.name}</div>
                        <div class="text-[10px] font-mono text-ink-400">{s.hex}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <SectionTitle n="3" title="Typography" hint="Inter" />
                <div class="card p-5 space-y-3">
                  <div><div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">page title · text-2xl / extrabold / tracking-tight</div><div class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">Franklin Fund</div></div>
                  <div><div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">section · text-lg / extrabold</div><div class="text-lg font-extrabold tracking-tight text-ink dark:text-white">Workflows</div></div>
                  <div><div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">body · text-sm</div><div class="text-sm text-ink-700 dark:text-white/80">Your checklist, run for you, reviewed before it leaves.</div></div>
                  <div><div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">eyebrow · text-[11px] / uppercase / tracking-wide</div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">At a glance</div></div>
                  <div><div class="text-[11px] uppercase tracking-wide text-ink-400 mb-1">number · tabular-nums</div><div class="text-sm tabular-nums text-ink-700 dark:text-white/80">$12,480.50 &middot; 46 correct · 1 needs review</div></div>
                </div>
              </section>

              <section>
                <SectionTitle n="4" title="Components" hint="pills · dots · buttons · tabs · inputs" />
                <div class="card p-5">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Status pills</div>
                  <div class="flex flex-wrap gap-2">
                    <span class="pill bg-leaf-50 text-leaf-700 dark:bg-leaf-900/40 dark:text-leaf-300">correct</span>
                    <span class="pill bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300">needs review</span>
                    <span class="pill bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300">held</span>
                    <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">ready to run</span>
                    <span class="pill bg-grape-50 text-grape-500 dark:bg-grape-900/40 dark:text-grape-300">rule</span>
                    <span class="pill bg-pump-50 text-pump-600 dark:bg-pump-900/40 dark:text-pump-300">data</span>
                  </div>
                </div>
                <div class="card p-5 mt-3">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Status dots</div>
                  <div class="flex flex-wrap items-center gap-4">
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-leaf-500"></span>complete</span>
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse"></span>running</span>
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-sun-500"></span>needs re-run</span>
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-ink-400"></span>held</span>
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-brand-300"></span>ready</span>
                    <span class="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-white/80"><span class="w-2.5 h-2.5 rounded-full bg-ink-300 dark:bg-white/[0.2]"></span>not run</span>
                  </div>
                </div>
                <div class="card p-5 mt-3">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Buttons</div>
                  <div class="flex flex-wrap items-center gap-3">
                    <button class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition">Primary</button>
                    <button class="rounded-xl bg-leaf-500 hover:bg-leaf-600 px-4 py-2.5 text-sm font-semibold text-white transition">Approve / run</button>
                    <button class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] dark:border-white/[0.1] dark:hover:bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:text-white/80 transition">Secondary</button>
                    <button class="rounded-xl border border-coral-200 hover:bg-coral-50 px-4 py-2.5 text-sm font-semibold text-coral-600 dark:border-coral-800 dark:hover:bg-coral-900/30 dark:text-coral-300 transition">Destructive</button>
                  </div>
                </div>
                <div class="card p-5 mt-3">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Nav tabs</div>
                  <div class="flex flex-wrap gap-1 border-b border-ink/[0.07] dark:border-white/[0.07]">
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">Home</span>
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ink-600 dark:text-white/80">Chat</span>
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ink-600 dark:text-white/80">Privacy Map</span>
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ink-600 dark:text-white/80">Rules</span>
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ink-600 dark:text-white/80">Data</span>
                    <span class="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-ink-600 dark:text-white/80">Make Workflow</span>
                  </div>
                </div>
                <div class="card p-5 mt-3">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Inputs</div>
                  <div class="space-y-3">
                    <input type="text" placeholder="Text input" class="w-full rounded-xl border border-ink/[0.12] bg-[#F3F5F9] px-3 py-2 text-sm text-ink dark:bg-ink-800 dark:border-white/[0.1] dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition" />
                    <textarea rows={2} placeholder="Textarea" class="w-full rounded-xl border border-ink/[0.12] bg-[#F3F5F9] px-3 py-2 text-sm text-ink dark:bg-ink-800 dark:border-white/[0.1] dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition"></textarea>
                  </div>
                </div>
                <div class="card p-5 mt-3">
                  <div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold mb-3">Rule attribution</div>
                  <div class="flex flex-wrap items-center gap-3">
                    <span class="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 px-2 py-1">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                      <span class="text-[11px] font-semibold uppercase tracking-wide">bank-reconciliation</span>
                    </span>
                    <span class="inline-flex items-center justify-center rounded-lg bg-brand-500 text-white h-9 w-9 text-sm font-bold">FF</span>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle n="5" title="Cards · client" hint="firm zone · client identity, primary" />
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <ClientCard
                    id="menu-ff"
                    initials="FF"
                    name="Franklin Fund"
                    sub="FY2026 Q1 · fund administration"
                    bg="bg-brand-500"
                    pills={[
                      { txt: "1 waiting on you", cls: "bg-sun-50 text-sun-600 dark:bg-sun-900/40 dark:text-sun-300" },
                      { txt: "46 correct", cls: "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white" },
                    ]}
                  />
                  <ClientCard
                    id="menu-st"
                    initials="ST"
                    name="Smith Family Trust"
                    sub="FY2025 · trust accounting"
                    bg="bg-grape-500"
                    pills={[
                      { txt: "1 needs review", cls: "bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300" },
                      { txt: "21 correct", cls: "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white" },
                    ]}
                  />
                  <ClientCard
                    id="menu-gi"
                    initials="GI"
                    name="Greentech Initiatives"
                    sub="FY2026 Q1 · grants reporting"
                    bg="bg-leaf-500"
                    pills={[
                      { txt: "12 correct", cls: "bg-ink/[0.05] text-ink-600 dark:bg-white/[0.06] dark:text-white" },
                    ]}
                  />
                  <span class="flex min-h-[132px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-ink/[0.13] p-5 text-ink-400 dark:border-white/[0.12]">
                    <span class="ico-box h-9 w-9 shrink-0 rounded-full bg-white border border-ink/[0.09] text-brand-500 dark:bg-ink-800 dark:border-white/[0.09]">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
                    </span>
                    <span class="mt-2 text-xs font-semibold">Add client</span>
                  </span>
                </div>
              </section>

              <section>
                <SectionTitle n="6" title="Cards · workflow row" hint="client shell · status variants" />
                <div class="mb-5">
                  <GroupHeader iconBg="bg-brand-50" iconClass="text-brand-500 dark:bg-brand-900/40 dark:text-brand-300" label="Month-end close" />
                  <div class="space-y-2">
                    <WorkflowRowCard
                      iconBg="bg-sun-500"
                      iconClass="text-white"
                      iconName="running"
                      title="Bank reconciliation"
                      sub="running · last run Aug 31, 11:43 PM"
                      right={<span class="pill bg-sun-500 text-white shrink-0">waiting on you</span>}
                      accentBorder="border-sun-200 dark:border-sun-800"
                    />
                    <WorkflowRowCard
                      iconBg="bg-leaf-50"
                      iconClass="text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300"
                      iconName="complete"
                      title="Tie out trial balance"
                      sub="done · Aug 31"
                      right={<span class="pill bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300 shrink-0">done</span>}
                    />
                    <WorkflowRowCard
                      iconBg="bg-ink/[0.06]"
                      iconClass="text-ink-500 dark:bg-white/[0.06] dark:text-white/70"
                      iconName="stale"
                      title="Post adjusting entries"
                      sub="needs re-run · data changed since Aug 29"
                      right={<span class="pill bg-ink/[0.06] text-ink-600 dark:bg-white/[0.08] dark:text-white shrink-0">needs re-run</span>}
                    />
                    <WorkflowRowCard
                      iconBg="bg-ink/[0.04]"
                      iconClass="text-ink-400 dark:bg-white/[0.04] dark:text-white/40"
                      iconName="notrun"
                      title="Prepare board package"
                      sub="not run"
                      right={
                        <button class="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                          <Icon name="play" size={13} /> Run
                        </button>
                      }
                    />
                  </div>
                </div>
                <div class="mb-5">
                  <GroupHeader iconBg="bg-grape-50" iconClass="text-grape-500 dark:bg-grape-900/40 dark:text-grape-300" label="Capital calls" />
                  <div class="space-y-2">
                    <WorkflowRowCard
                      iconBg="bg-coral-50"
                      iconClass="text-coral-500 dark:bg-coral-900/40 dark:text-coral-300"
                      iconName="flagged"
                      title="Capital call #5"
                      sub="flagged · 1 exception · Aug 31"
                      right={<span class="pill bg-coral-50 text-coral-600 dark:bg-coral-900/40 dark:text-coral-300 shrink-0">needs review</span>}
                    />
                    <WorkflowRowCard
                      iconBg="bg-grape-50"
                      iconClass="text-grape-500 dark:bg-grape-900/40 dark:text-grape-300"
                      iconName="skills"
                      title="Commitment HTML report"
                      sub="done · Aug 31"
                      right={<span class="pill bg-leaf-50 text-leaf-600 dark:bg-leaf-900/40 dark:text-leaf-300 shrink-0">done</span>}
                    />
                  </div>
                </div>
                <div class="mb-5">
                  <GroupHeader iconBg="bg-coral-50" iconClass="text-coral-500 dark:bg-coral-900/40 dark:text-coral-300" label="By email" />
                  <div class="space-y-2">
                    <WorkflowRowCard
                      iconBg="bg-pump-50"
                      iconClass="text-pump-500 dark:bg-pump-900/40 dark:text-pump-300"
                      iconName="processed"
                      title="Vendor invoices"
                      sub="runs when an email arrives · 12 processed this quarter"
                      right={
                        <span class="pill bg-pump-50 text-pump-500 dark:bg-pump-900/40 dark:text-pump-300 shrink-0">
                          <Icon name="thread" size={12} /> by email
                        </span>
                      }
                    />
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle n="7" title="At a glance" hint="single-card summary" />
                <GlanceCard />
              </section>

              <section>
                <SectionTitle n="8" title="Client identity header" hint="top of every client shell" />
                <ClientIdentityHeader />
              </section>

              <p class="text-center text-xs text-ink-400 pb-4 pt-2">Reference only · components mirror MOCKUP_V5/ · try the dark-mode toggle.</p>
            </div>

            <aside class="space-y-6">
              <div class="card p-5">
                <h2 class="text-xs font-bold uppercase tracking-wider text-ink-500 mb-4">This week</h2>
                <div class="space-y-4">
                  <div>
                    <div class="flex items-center justify-between text-sm mb-1.5">
                      <span class="text-ink-600 dark:text-white">Awaiting you</span>
                      <span class="font-bold text-ink dark:text-white">2</span>
                    </div>
                    <div class="h-2 rounded-full bg-ink/[0.07] dark:bg-white/[0.08] overflow-hidden">
                      <div class="h-full w-[40%] rounded-full bg-sun-500"></div>
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center justify-between text-sm mb-1.5">
                      <span class="text-ink-600 dark:text-white">Correct this week</span>
                      <span class="font-bold text-ink dark:text-white">79</span>
                    </div>
                    <div class="h-2 rounded-full bg-ink/[0.07] dark:bg-white/[0.08] overflow-hidden">
                      <div class="h-full w-[84%] rounded-full bg-leaf-500"></div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="card p-5">
                <h2 class="text-xs font-bold uppercase tracking-wider text-ink-500 mb-4">Recent activity</h2>
                <ul class="space-y-3.5">
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-coral-500"></span>
                    <div class="min-w-0">
                      <div class="text-sm text-ink dark:text-white font-medium leading-snug">JE-104 needs review — Franklin Fund</div>
                      <div class="text-xs text-ink-500 mt-0.5">12 min ago</div>
                    </div>
                  </li>
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-sun-500"></span>
                    <div class="min-w-0">
                      <div class="text-sm text-ink dark:text-white font-medium leading-snug">W-208 awaiting approval — Smith Trust</div>
                      <div class="text-xs text-ink-500 mt-0.5">38 min ago</div>
                    </div>
                  </li>
                  <li class="flex items-start gap-3">
                    <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-leaf-500"></span>
                    <div class="min-w-0">
                      <div class="text-sm text-ink dark:text-white font-medium leading-snug">Capital call #5 done — Smith Trust</div>
                      <div class="text-xs text-ink-500 mt-0.5">2 hr ago</div>
                    </div>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </main>
      </body>
    </html>,
  );
});
