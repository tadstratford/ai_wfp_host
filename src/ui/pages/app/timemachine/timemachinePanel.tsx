import { Context } from "hono";
import type { User } from "@backend/types";
import type { ProvenanceEvent } from "wfp-format";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getSessionOrigin, flushActiveWorkspace } from "@backend/core/workspace/workspaceLifecycle";
import { loadContent } from "@backend/core/workspace/contentStore";
import { reconstructState, reconstructWfp } from "@backend/core/workspace/reconstruct";
import { hashValue } from "@backend/core/workspace/hash";

// ── helpers ─────────────────────────────────────────────────────────────────

function humanizeTarget(target: string): string {
  const idx = target.indexOf(":");
  const kind = idx === -1 ? target : target.slice(0, idx);
  const name = idx === -1 ? "" : target.slice(idx + 1);
  switch (kind) {
    case "workflow": return name ? `Workflow “${name}”` : "Workflow";
    case "tool": return name ? `Tool “${name}”` : "Tool";
    case "knowledge": return `Knowledge pack “${name}”`;
    case "data": return `Data entry “${name}”`;
    case "session": return "Session";
    case "rule": return `Rule “${name}”`;
    case "log": return "LLM log";
    case "metadata": return "Workspace metadata";
    case "plan": return "Plan";
    case "todos": return "Todos";
    case "saved_prompts": return "Saved prompts";
    case "privacy_mask": return "Privacy map";
    case "checkpoint": return "Checkpoint";
    default: return target;
  }
}

function actionLabel(action: string): string {
  return action === "delete" ? "Deleted" : "Updated";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortHash(h: string | null): string {
  return h ? h.slice(0, 10) : "";
}

/** Pretty-print a stored JSON string; leave non-JSON text untouched. */
function prettyValue(s: string | null): string {
  if (s === null || s === "") return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Summarize a bucket of changes (since the previous checkpoint) into a compact,
 *  human-readable list — the deterministic "what happened" rationale. */
function summarizeChanges(changes: Array<{ action: string; target: string }>): string {
  if (changes.length === 0) return "No changes since the previous checkpoint.";
  const seen = new Map<string, string>();
  for (const c of changes) seen.set(c.target, c.action);
  const parts = Array.from(seen.entries()).map(([target, action]) =>
    `${actionLabel(action).toLowerCase()} ${humanizeTarget(target)}`,
  );
  const capped = parts.slice(0, 6);
  const suffix = parts.length > 6 ? ` and ${parts.length - 6} more` : "";
  return `${capped.join("; ")}${suffix}`;
}

/** True for high-volume, low-value targets (LLM logs, chat/automation sessions)
 *  that pollute the timeline; hidden unless the user asks to see all activity. */
function isChurn(target: string): boolean {
  return target.startsWith("session:") || target.startsWith("log:");
}

// ── timeline view ───────────────────────────────────────────────────────────

/**
 * Time Machine — the read-only history browser for the append-only provenance
 * ledger. Checkpoints are rendered as landmarks; change events as a compact
 * "who did what, when" timeline (most recent first). Clicking a change row
 * loads its old→new diff.
 */
export const timeMachineView = (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  const allEvents: ProvenanceEvent[] = session ? session.getProvenance() : [];

  // Hide session/log churn by default; `?all=1` reveals the full activity log.
  const showAll = c.req.query("all") === "1";
  const events = showAll ? allEvents : allEvents.filter((e) => e.kind !== "change" || !isChurn(e.target));
  const churnCount = allEvents.filter((e) => e.kind === "change" && isChurn(e.target)).length;

  const checkpoints = events.filter((e) => e.kind === "checkpoint").length;
  const changes = events.filter((e) => e.kind === "change").length;

  // Bucket change events per checkpoint (forward pass).
  const checkpointChanges = new Map<string, Array<{ action: string; target: string }>>();
  let bucket: Array<{ action: string; target: string }> = [];
  for (const e of events) {
    if (e.kind === "checkpoint") {
      checkpointChanges.set(e.id, bucket);
      bucket = [];
    } else {
      bucket.push({ action: e.action, target: e.target });
    }
  }

  const reversed = [...events].reverse();

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="mb-6">
        <h2 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white mb-1">Time Machine</h2>
        <p class="text-sm text-ink-500">
          An un-erasable, tamper-evident history of every change to this workspace.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2 mb-6">
        <span class="pill bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
          {checkpoints} {checkpoints === 1 ? "checkpoint" : "checkpoints"}
        </span>
        <span class="pill bg-ink/[0.04] text-ink-500 dark:bg-white/[0.06] dark:text-white/60">
          {changes} {changes === 1 ? "change" : "changes"}
        </span>
        {churnCount > 0 && (
          <button
            hx-get={showAll ? "/app/timemachine" : "/app/timemachine?all=1"}
            hx-target="#main-panel"
            hx-swap="innerHTML"
            class="ml-auto text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline cursor-pointer"
          >
            {showAll ? "Hide sessions & LLM logs" : `Show sessions & LLM logs (${churnCount})`}
          </button>
        )}
      </div>

      <form
        hx-post="/app/timemachine/snapshot"
        hx-target="#main-panel"
        hx-swap="innerHTML"
        class="flex items-center gap-2 mb-4"
      >
        <input
          type="text"
          name="label"
          placeholder="Snapshot label (e.g. October close)"
          class="flex-1 rounded-xl border border-ink/[0.12] bg-white px-3 py-2 text-sm text-ink dark:bg-ink-800 dark:border-white/[0.1] dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400"
        />
        <button
          type="submit"
          class="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition"
        >
          Snapshot now
        </button>
      </form>

      {reversed.length === 0 ? (
        <div class="card p-10 text-center text-sm text-ink-500">
          No history yet. Every change you make is recorded here automatically.
        </div>
      ) : (
        <div class="space-y-1.5">
          {reversed.map((e) =>
            e.kind === "checkpoint" ? (
              <details class="group">
                <summary
                  class="card p-4 border-l-4 border-l-brand-500 bg-brand-50/40 dark:bg-brand-900/15 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-brand-50/70 dark:hover:bg-brand-900/25 transition-colors"
                  hx-get={`/app/timemachine/checkpoint/${e.id}`}
                  hx-target={`#cpdetail-${e.id}`}
                  hx-swap="innerHTML"
                  hx-trigger="click once"
                >
                  <div class="flex items-center gap-2.5 mb-1">
                    <svg class="w-4 h-4 text-brand-500 dark:text-brand-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-3-6.708" />
                    </svg>
                    <span class="text-sm font-semibold text-ink dark:text-white">{e.label || "Checkpoint"}</span>
                    <span class="text-xs text-ink-400 dark:text-white/50 ml-auto">{fmtTime(e.eventAt)}</span>
                  </div>
                  <div class="text-xs text-ink-500 dark:text-white/60 pl-6 flex items-center justify-between gap-2">
                    <span class="min-w-0 truncate">
                      {e.rationale ?? summarizeChanges(checkpointChanges.get(e.id) ?? [])}
                    </span>
                    <span class="text-brand-600 dark:text-brand-300 font-semibold shrink-0">Compare with now ›</span>
                  </div>
                </summary>
                <div id={`cpdetail-${e.id}`}></div>
              </details>
            ) : (
              <details class="group">
                <summary
                  class="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-ink/[0.06] dark:border-white/[0.06] bg-white dark:bg-ink-800 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-ink/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                  hx-get={`/app/timemachine/diff/${e.id}`}
                  hx-target={`#diff-${e.id}`}
                  hx-swap="innerHTML"
                  hx-trigger="click once"
                >
                  <span class={`h-1.5 w-1.5 rounded-full shrink-0 ${e.action === "delete" ? "bg-coral-400" : "bg-brand-400"}`} />
                  <span class="text-sm text-ink-700 dark:text-white min-w-0 truncate">
                    {actionLabel(e.action)} {humanizeTarget(e.target)}
                  </span>
                  <span class="text-xs text-ink-400 dark:text-white/50 shrink-0 ml-auto">
                    {e.producer}
                    {e.producerVersion ? ` ${e.producerVersion}` : ""}
                  </span>
                  <span class="text-xs text-ink-400 dark:text-white/50 shrink-0 hidden sm:block">{fmtTime(e.eventAt)}</span>
                  {shortHash(e.newContentHash) && (
                    <span
                      title={e.newContentHash ?? ""}
                      class="text-[10px] font-mono text-ink-300 dark:text-white/30 shrink-0 hidden md:block"
                    >
                      {shortHash(e.newContentHash)}
                    </span>
                  )}
                </summary>
                <div id={`diff-${e.id}`}></div>
              </details>
            ),
          )}
        </div>
      )}
    </div>,
  );
};

// ── diff view (per change event) ────────────────────────────────────────────

/** Old→new diff for a single change event, loaded on click. */
export const timeMachineDiffView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const eventId = c.req.param("eventId");
  if (!databaseId || !eventId) return c.html(<div class="p-4 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.html(<div class="p-4 text-coral-500">No workspace open</div>);

  const event = session.getProvenanceEvent(eventId);
  if (!event || event.kind !== "change") return c.html(<div class="p-4 text-ink-500">Event not found</div>);

  const origin = getSessionOrigin(session);
  const workspaceId = origin && origin.kind === "supabase" ? origin.workspaceId : null;
  const secret = session.getSecret();

  // Previous value = the latest change event for the same target before this one.
  const events = session.getProvenance();
  const idx = events.findIndex((x) => x.id === eventId);
  let prev: ProvenanceEvent | null = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (events[i].kind === "change" && events[i].target === event.target) {
      prev = events[i];
      break;
    }
  }

  let before: string | null = null;
  let after: string | null = null;
  if (workspaceId) {
    if (prev?.newContentHash) before = await loadContent(workspaceId, prev.newContentHash, secret);
    if (event.newContentHash) after = await loadContent(workspaceId, event.newContentHash, secret);
  }

  const unavailable =
    before === null && after === null
      ? "Historical content isn't available for this change (large data files and unsaved values aren't stored)."
      : null;

  return c.html(
    <div class="px-4 pb-3 pt-2">
      <div class="rounded-xl border border-ink/[0.08] dark:border-white/[0.08] bg-ink/[0.02] dark:bg-white/[0.02] p-3">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-white/50 mb-2">
          {actionLabel(event.action)} {humanizeTarget(event.target)} — {fmtTime(event.eventAt)}
        </div>
        {unavailable ? (
          <p class="text-xs text-ink-500">{unavailable}</p>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <div class="text-[11px] font-semibold text-coral-500 mb-1">Before</div>
              <pre class="text-[11px] font-mono text-ink-600 dark:text-white/80 bg-white dark:bg-ink-900 rounded-lg p-2.5 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{prettyValue(before) || "—"}</pre>
            </div>
            <div>
              <div class="text-[11px] font-semibold text-leaf-500 mb-1">After</div>
              <pre class="text-[11px] font-mono text-ink-600 dark:text-white/80 bg-white dark:bg-ink-900 rounded-lg p-2.5 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">{event.action === "delete" ? "(deleted)" : prettyValue(after) || "—"}</pre>
            </div>
          </div>
        )}
      </div>
    </div>,
  );
};

// ── checkpoint view (compare checkpoint → now) ──────────────────────────────

/** Reconstruct the state at a checkpoint and diff it against the current
 *  workspace state, showing what changed since that checkpoint. */
export const timeMachineCheckpointView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const checkpointId = c.req.param("id");
  if (!databaseId || !checkpointId) return c.html(<div class="p-4 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.html(<div class="p-4 text-coral-500">No workspace open</div>);

  const cp = session.getProvenanceEvent(checkpointId);
  if (!cp || cp.kind !== "checkpoint") return c.html(<div class="p-4 text-ink-500">Checkpoint not found</div>);

  const origin = getSessionOrigin(session);
  const workspaceId = origin && origin.kind === "supabase" ? origin.workspaceId : null;
  const secret = session.getSecret();

  const stateAt = reconstructState(session.getProvenance(), checkpointId);

  let snapshotEntryCount: number | null = null;
  if (cp.snapshotHash && workspaceId) {
    const snap = await loadContent(workspaceId, cp.snapshotHash, secret);
    if (snap) {
      try {
        snapshotEntryCount = Object.keys(JSON.parse(snap) ?? {}).length;
      } catch {
        snapshotEntryCount = 0;
      }
    }
  }

  const rows: Array<{ target: string; before: string | null; current: string | null; deletedAtCp: boolean }> = [];
  for (const target of Array.from(stateAt.keys()).sort()) {
    const s = stateAt.get(target)!;
    const current = session.getNodeValue(target);
    const currentHash = current === null || current === undefined ? null : hashValue(current);
    if ((s.hash ?? null) === currentHash) continue; // unchanged since the checkpoint

    let before: string | null = null;
    if (s.hash && workspaceId) before = await loadContent(workspaceId, s.hash, secret);
    const currentStr = current === null || current === undefined ? null : JSON.stringify(current);
    rows.push({ target, before, current: currentStr, deletedAtCp: s.deleted });
  }

  const note =
    rows.length > 0 &&
    rows.some((r) => r.before === null && !r.deletedAtCp)
      ? "Large data files aren't stored in the Time Machine, so their earlier content can't be shown."
      : null;

  return c.html(
    <div class="px-4 pb-3 pt-2">
      {cp.snapshotHash && (
        <div class="rounded-xl border border-leaf-200 dark:border-leaf-900/40 bg-leaf-50/40 dark:bg-leaf-900/15 p-3 mb-2">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-leaf-600 dark:text-leaf-300 mb-1">
            Point-in-time snapshot captured
          </div>
          <p class="text-xs text-ink-600 dark:text-white/80 mb-1">
            {snapshotEntryCount === null
              ? "A full data snapshot is available for this checkpoint."
              : `${snapshotEntryCount} ${snapshotEntryCount === 1 ? "data entry" : "data entries"} captured as of this snapshot.`}
          </p>
          <a href={`/app/timemachine/download/${cp.id}`} class="text-xs font-semibold text-brand-600 dark:text-brand-300 hover:underline">
            Download this snapshot as a .wfp
          </a>
        </div>
      )}
      <div class="rounded-xl border border-brand-100 dark:border-brand-900/40 bg-brand-50/40 dark:bg-brand-900/15 p-3">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">
            Changed since “{cp.label || "checkpoint"}” ({fmtTime(cp.eventAt)})
          </div>
        </div>
        {rows.length === 0 ? (
          <p class="text-xs text-ink-500">Nothing has changed since this checkpoint.</p>
        ) : (
          <div class="space-y-2.5">
            {note && <p class="text-[11px] text-ink-400 dark:text-white/50">{note}</p>}
            {rows.map((r) => (
              <div>
                <div class="text-xs font-semibold text-ink-700 dark:text-white mb-1">
                  {humanizeTarget(r.target)}
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div class="text-[11px] font-semibold text-coral-500 mb-1">Then</div>
                    <pre class="text-[11px] font-mono text-ink-600 dark:text-white/80 bg-white dark:bg-ink-900 rounded-lg p-2.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">{r.deletedAtCp ? "(deleted)" : prettyValue(r.before) || "—"}</pre>
                  </div>
                  <div>
                    <div class="text-[11px] font-semibold text-leaf-500 mb-1">Now</div>
                    <pre class="text-[11px] font-mono text-ink-600 dark:text-white/80 bg-white dark:bg-ink-900 rounded-lg p-2.5 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">{r.current === null ? "(deleted)" : prettyValue(r.current) || "—"}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
  );
};

// ── snapshot (period close) ─────────────────────────────────────────────────

/** Create a point-in-time snapshot: a checkpoint that also captures the full
 *  `data` section so the workspace can be reconstructed (and downloaded) as-of
 *  this moment. */
export const timeMachineSnapshotHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.html(<div class="p-6 text-coral-500">No workspace loaded</div>);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.html(<div class="p-6 text-coral-500">No workspace open</div>);

  const body = await c.req.parseBody();
  const label = String(body.label ?? "").trim() || undefined;
  session.recordSnapshot({ label });
  await flushActiveWorkspace(databaseId);

  return timeMachineView(c);
};

// ── download a checkpoint as a .wfp ─────────────────────────────────────────

/** Reconstruct the workspace as-of a checkpoint (including its data snapshot
 *  when one exists) and download it as a `.wfp` file. */
export const timeMachineDownloadView = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const checkpointId = c.req.param("id");
  if (!databaseId || !checkpointId) return c.text("No workspace loaded", 400);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.text("No workspace open", 400);

  const cp = session.getProvenanceEvent(checkpointId);
  if (!cp || cp.kind !== "checkpoint") return c.text("Checkpoint not found", 404);

  const origin = getSessionOrigin(session);
  const workspaceId = origin && origin.kind === "supabase" ? origin.workspaceId : null;
  if (!workspaceId) return c.text("Not available for this workspace", 400);

  const secret = session.getSecret();
  const stateAt = reconstructState(session.getProvenance(), checkpointId);
  const load = (hash: string) => loadContent(workspaceId, hash, secret);
  const wfp = await reconstructWfp(stateAt, load, cp.snapshotHash ?? null);
  wfp.metadata.workspace = `${wfp.metadata.workspace || "Workspace"} (as of ${cp.label || "checkpoint"})`;

  const content = JSON.stringify(wfp, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const safeName = (wfp.metadata.workspace || "workspace").replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "workspace";
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${safeName}_${date}.wfp"`);
  return c.body(content);
};
