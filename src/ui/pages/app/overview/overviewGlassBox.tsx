import { Context } from "hono";
import type { User } from "@backend/types";
import { assembleWorkspaceState, type WorkspaceState, type NextMove } from "@backend/core/overview/workspaceState";
import { toneLine, generativeBlocks, type GenBlock } from "@backend/core/overview/glassBoxNarrator";
import { activeShellId } from "../shellUrls";
import { getSessionIdsByTodo } from "@backend/core/session/sessions/session_all";

/**
 * Overview "Glass Box" band — the four-layer lens (What · Trust · Next), pointed
 * at the workspace itself. Two interchangeable renderings, switched by a toggle:
 *
 *   /app/overview-glassbox  → deterministic band + one LLM-phrased headline.
 *   /app/overview-genui     → fully generative: the model composes the card from
 *                             a whitelisted block vocabulary (docs/GEN_UI_RULES.md).
 *
 * Both render the SAME deterministic state; only the deterministic band carries
 * the SSE self-refresh, so switching to the generative view is sticky until the
 * user switches back (predictable, no fl/icker on every todo update).
 */

// ── Shared bits ──────────────────────────────────────────────────────────────

const CARD =
  "card rounded-xl p-4";

function CheckIcon() {
  return (
    <svg class="w-4 h-4 text-leaf-600 dark:text-leaf-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg class="w-4 h-4 text-sun-500 dark:text-sun-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
    </svg>
  );
}

/** Two links — one per rendering. The whole band lives in #ov-glassbox and is
 *  swapped by outerHTML, so each link targets that container. */
function Toggle(active: "det" | "gen") {
  const base = "text-xs font-medium px-2 py-1 rounded-md cursor-pointer transition-colors";
  const on = "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300";
  const off = "text-ink-500 hover:bg-ink/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06]";
  return (
      <div class="flex items-center gap-1">
        <a hx-get="/app/overview-glassbox" hx-target="#ov-glassbox" hx-swap="outerHTML" class={`${base} ${active === "det" ? on : off}`}>
          Calculated
        </a>
        <a hx-get="/app/overview-genui" hx-target="#ov-glassbox" hx-swap="outerHTML" class={`${base} ${active === "gen" ? on : off}`}>
          AI-drafted
        </a>
      </div>
  );
}

interface ActionDescriptor {
  label: string;
  hxGet?: string;
  pushUrl?: string;
}

/** Map the deterministic NextMove (+ a couple of side actions) to real, existing
 *  routes. Nothing is invented: every target is a route the app already serves. */
function actionDescriptors(
  state: WorkspaceState,
  wsId: string,
  todoSessions: Record<string, string>,
): Record<string, ActionDescriptor> {
  const out: Record<string, ActionDescriptor> = {};
  const next = state.next;

  if (next.kind === "session") {
    out.next = {
      label: `Reply to “${next.label}”`,
      hxGet: `/app/session?session_id=${next.sessionId}&action=view`,
      pushUrl: `/app/chat?session_id=${next.sessionId}&action=view`,
    };
  } else if (next.kind === "exception") {
    out.next = {
      label: `Review ${next.label}`,
      hxGet: `/app/session?session_id=${next.sessionId}&action=view`,
    };
  } else if (next.kind === "plan") {
    const sid = todoSessions[next.todoId];
    out.next = sid
      ? {
          label: `Continue: ${next.label}`,
          hxGet: `/app/session?session_id=${sid}&action=view`,
          pushUrl: `/app/chat?session_id=${sid}&action=view`,
        }
      : {
          label: `Start: ${next.label}`,
          hxGet: `/app/session?action=new&prefill=${encodeURIComponent(next.instruction)}&todo_id=${next.todoId}`,
          pushUrl: `/app/chat?action=new&prefill=${encodeURIComponent(next.instruction)}&todo_id=${next.todoId}`,
        };
  }
  // "suggest" intentionally has no `next` action — it's a nudge, rendered inline.

  if (state.trust.failed > 0) {
    out.exceptions = { label: "Review audits", hxGet: "/app/overview" };
  }
  return out;
}

function ActionButton(a: ActionDescriptor, primary = true) {
  const cls = primary
    ? "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-xl bg-brand-500 hover:bg-brand-600 text-white no-underline cursor-pointer"
    : "inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-ink/[0.1] dark:border-white/[0.1] text-ink-600 dark:text-white/80 hover:bg-ink/[0.04] dark:hover:bg-white/[0.04] no-underline cursor-pointer";
  return (
    <a
      hx-get={a.hxGet}
      hx-target="#main-panel"
      hx-swap="innerHTML"
      {...(a.pushUrl ? { "hx-push-url": a.pushUrl } : {})}
      class={cls}
    >
      {a.label}
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
      </svg>
    </a>
  );
}

function TrustRow(state: WorkspaceState) {
  if (state.trust.total === 0) {
    return <span class="text-sm text-ink-400 dark:text-ink-500">No audits yet.</span>;
  }
  return (
    <div class="flex items-center gap-4">
      <span class="inline-flex items-center gap-1.5 text-sm text-ink-700 dark:text-white/80">
        <CheckIcon /> {state.trust.verified} correct
      </span>
      {state.trust.failed > 0 && (
        <span class="inline-flex items-center gap-1.5 text-sm text-coral-600 dark:text-coral-300">
          <WarnIcon /> {state.trust.failed} needs review
        </span>
      )}
    </div>
  );
}

// ── A. Deterministic band ────────────────────────────────────────────────────

export const overviewGlassBoxView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.body("");

  const wsId = activeShellId(user.userId);
  const todoSessions = getSessionIdsByTodo(databaseId);
  const state = await assembleWorkspaceState(databaseId);
  const headline = await toneLine(databaseId, state);
  const actions = actionDescriptors(state, wsId, todoSessions);

  const s = state.sessions;
  const where = [
    `${s.total} chat${s.total === 1 ? "" : "s"}`,
    s.awaitingYou > 0 ? `${s.awaitingYou} your turn` : null,
  ].filter(Boolean);

  return c.html(
    <div
      id="ov-glassbox"
      hx-get="/app/overview-glassbox"
      hx-trigger="sse:todo_update from:body"
      hx-swap="outerHTML"
      class={CARD}
    >
      <div class="flex items-start justify-between gap-3">
        <p class="text-base font-semibold text-ink dark:text-white leading-snug">{headline}</p>
        {Toggle("det")}
      </div>

      <div class="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-4">
        <div>
          <div class="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-1">Where you are</div>
          <div class="text-sm text-ink-700 dark:text-white/80">{where.join(" · ")}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-1">Audit results</div>
          {TrustRow(state)}
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-ink/[0.06] dark:border-white/[0.06]">
        <div class="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-2">Your next move</div>
        {actions.next ? (
          <div class="flex flex-wrap items-center gap-2">
            {ActionButton(actions.next, true)}
            {actions.exceptions && state.next.kind !== "exception" && ActionButton(actions.exceptions, false)}
          </div>
        ) : (
          <p class="text-sm text-ink-500 dark:text-ink-400">
            {state.next.label} — everything else is clear.
          </p>
        )}
      </div>
    </div>,
  );
};

// ── B. Generative band ───────────────────────────────────────────────────────

function renderBlock(b: GenBlock, state: WorkspaceState, actions: Record<string, ActionDescriptor>) {
  switch (b.type) {
    case "headline":
      return <p class="text-base font-semibold text-ink dark:text-white leading-snug">{b.text}</p>;
    case "note":
      return <p class="text-sm text-ink-600 dark:text-white/70">{b.text}</p>;
    case "stat": {
      const tone =
        b.tone === "good"
          ? "text-leaf-700 dark:text-leaf-300"
          : b.tone === "warn"
            ? "text-sun-600 dark:text-sun-400"
            : "text-ink-700 dark:text-white/80";
      return (
        <div class="inline-flex items-baseline gap-2 mr-5">
          <span class={`text-lg font-bold ${tone}`}>{b.value}</span>
          <span class="text-xs text-ink-500 dark:text-ink-400">{b.label}</span>
        </div>
      );
    }
    case "verdict":
      return TrustRow(state);
    case "action": {
      const a = actions[b.actionId];
      return a ? ActionButton(a, b.actionId === "next") : null;
    }
    default:
      return null;
  }
}

export const overviewGenUiView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.body("");

  const wsId = activeShellId(user.userId);
  const todoSessions = getSessionIdsByTodo(databaseId);
  const state = await assembleWorkspaceState(databaseId);
  const actions = actionDescriptors(state, wsId, todoSessions);
  const blocks = await generativeBlocks(databaseId, state, Object.keys(actions));

  return c.html(
    <div id="ov-glassbox" class={CARD}>
      <div class="flex items-center justify-between gap-3 mb-3">
        <span class="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500">
          AI-drafted · composed by the model
        </span>
        {Toggle("gen")}
      </div>
      <div class="space-y-3">
        {blocks.map((b) => renderBlock(b, state, actions))}
      </div>
    </div>,
  );
};
