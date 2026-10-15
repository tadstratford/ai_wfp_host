// WorkspaceSession — in-memory container for an open workspace.
//
// Holds the decrypted .wfp document, the encryption secret, and every other
// workspace-scoped runtime fact (pending pause Promises, privacy entity
// counter, lifecycle hooks). Everything is PRIVATE — no method returns a
// reference into the underlying WfpFile. All accessors return clones or
// projections.
//
// Trusted backend/core handlers call the typed accessors below. Custom tool
// code never sees this object — it gets a WFP_API constructed from it (via
// wfp-api `createWFP_API`, wired in M12).
//
// Lifecycle: one session per logged-in user; switching workspaces closes the
// previous session and constructs a new one. Process restart, logout, and
// idle timeout all close the session. Plaintext WfpFile and the encryption
// secret never persist; they live only in RAM for the session's duration.

import type {
  KnowledgePack,
  Metadata as WfpMetadata,
  PlanEntry,
  Session as ChatOrAutomationSession,
  Tool,
  TodoEntry,
  WfpFile,
  Workflow,
  SavedPrompt,
} from "wfp-format";
import type { Rule } from "wfp-format/rule";
import type { LLMLogEntry } from "wfp-format/logs";
import { getRules as _rulesGetAll, getRule as _rulesGetOne, upsertRule as _rulesUpsert, deleteRule as _rulesDelete } from "../rules/store";

/** Hard cap on retained sessions per workspace. Older sessions are pruned on
 *  upsert (newest by `updated_at` kept). */
const MAX_SESSIONS = 50;
/** Hard cap on retained LLM log entries per workspace. */
const MAX_LOGS = 50;

/** WFP sections tracked for incremental re-encrypt (mirrors workspaceStore). */
export type WfpSectionName =
  | "metadata"
  | "workflows"
  | "tools"
  | "data"
  | "knowledge"
  | "sessions"
  | "logs"
  | "misc";

const ALL_SECTIONS: WfpSectionName[] = [
  "metadata",
  "workflows",
  "tools",
  "data",
  "knowledge",
  "sessions",
  "logs",
  "misc",
];

export type CloseHook = () => void | Promise<void>;

interface PendingPause {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  registeredAt: number;
}

// Strip removed top-level fields from legacy .wfp files so old documents
// round-trip cleanly without carrying dead payload.
function normalizeWfp(wfp: WfpFile): WfpFile {
  const raw = wfp as unknown as Record<string, unknown>;
  if ("qbo" in raw) delete raw.qbo;
  return wfp;
}

export interface WorkspaceSessionArgs {
  userId: string;
  workspaceId: string;
  /** Plaintext .wfp document — caller has already decrypted if needed. */
  wfp: WfpFile;
  /** Encryption secret for re-saving. `null` when the workspace was opened
   *  from a plaintext source (file picker without encryption). */
  secret: string | null;
  /** Legacy host identifier (admin_users.database_id). Used by the
   *  workspaceSessionStore reverse index so backend/core handlers that
   *  receive `databaseId` from `user.currentDatabaseId` can find the
   *  active session. Optional for OSS use of this class. */
  databaseId?: string;
}

export class WorkspaceSession {
  // ── PRIVATE state ─────────────────────────────────────────────────────
  // Class-private fields (#) are not visible to subclasses or callers and
  // do not appear in object spreads. This is the enforcement boundary for
  // D6 (encapsulation).
  readonly #userId: string;
  readonly #workspaceId: string;
  readonly #databaseId: string | null;
  readonly #wfp: WfpFile;
  #secret: string | null;
  #lastActivityAt: number;
  #mutationCounter = 0;
  #savedAtCounter = 0;
  #closed = false;
  readonly #pendingPauses = new Map<string, PendingPause>();
  #privacyEntityCounter = 0;
  readonly #beforeCloseHooks: CloseHook[] = [];
  readonly #closeHooks: CloseHook[] = [];
  readonly #mutateHooks: Array<() => void> = [];
  // Sections changed since the last successful flush, so auto-save can
  // re-encrypt only the dirty columns.
  readonly #dirtySections = new Set<WfpSectionName>();

  constructor(args: WorkspaceSessionArgs) {
    this.#userId = args.userId;
    this.#workspaceId = args.workspaceId;
    this.#databaseId = args.databaseId ?? null;
    this.#wfp = normalizeWfp(args.wfp);
    this.#secret = args.secret;
    this.#lastActivityAt = Date.now();
  }

  // ── Identity / lifecycle status ───────────────────────────────────────
  get userId(): string {
    return this.#userId;
  }
  get workspaceId(): string {
    return this.#workspaceId;
  }
  get databaseId(): string | null {
    return this.#databaseId;
  }
  get lastActivityAt(): number {
    return this.#lastActivityAt;
  }
  get isClosed(): boolean {
    return this.#closed;
  }
  touch(section?: WfpSectionName): void {
    if (!this.#closed) {
      this.#lastActivityAt = Date.now();
      this.#mutationCounter++;
      if (section) this.#dirtySections.add(section);
      for (const cb of this.#mutateHooks) {
        try { cb(); } catch (e) { console.error("[WorkspaceSession] mutate hook error:", e); }
      }
    }
  }

  /** Sections changed since the last successful flush (for incremental save). */
  getDirtySections(): WfpSectionName[] {
    return Array.from(this.#dirtySections);
  }

  /** Mark the given sections as persisted. With no argument, clears all. */
  clearDirtySections(sections?: WfpSectionName[]): void {
    if (sections) {
      for (const s of sections) this.#dirtySections.delete(s);
    } else {
      this.#dirtySections.clear();
    }
  }

  /**
   * Read-safe activity bump: resets the idle-timeout clock WITHOUT marking the
   * session dirty or firing mutate hooks. Call this on navigation / read-only
   * requests so that simply using the workspace (viewing reports, switching
   * sections) keeps the session alive — unlike `touch()`, which is for actual
   * mutations and would schedule a spurious auto-save on every page view.
   */
  markActive(): void {
    if (!this.#closed) this.#lastActivityAt = Date.now();
  }

  /** Register a callback fired on every mutation (used by auto-save to
   *  schedule a debounced flush). */
  onMutate(cb: () => void): void {
    if (!this.#closed) this.#mutateHooks.push(cb);
  }

  /** True if mutations have occurred since the last markSaved(). Drives the
   *  "Modified" badge. */
  isDirty(): boolean {
    return this.#mutationCounter !== this.#savedAtCounter;
  }

  /** Snapshot the current mutation count as the persisted baseline. Called
   *  after a successful save so isDirty() reads false until the next change. */
  markSaved(): void {
    this.#savedAtCounter = this.#mutationCounter;
  }

  // ── Metadata (clones) ─────────────────────────────────────────────────
  getWorkspaceName(): string {
    this.#assertOpen();
    return this.#wfp.metadata.workspace;
  }

  getFormatVersion(): string {
    this.#assertOpen();
    return this.#wfp.metadata.format_version;
  }

  /** Return a deep clone of the .wfp metadata block. */
  getMetadata(): WfpMetadata {
    this.#assertOpen();
    return structuredClone(this.#wfp.metadata);
  }

  /**
   * Merge a partial patch into the .wfp metadata. Fields not in `patch`
   * keep their current values. Pass `null` for a field to clear it.
   */
  updateMetadata(patch: Partial<WfpMetadata>): void {
    this.#assertOpen();
    const cloned = structuredClone(patch);
    this.#wfp.metadata = { ...this.#wfp.metadata, ...cloned };
    this.touch("metadata");
  }

  // ── Workflows ─────────────────────────────────────────────────────────
  getWorkflows(): Workflow[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.workflows ?? []);
  }

  getWorkflow(id: string): Workflow | null {
    this.#assertOpen();
    const found = this.#wfp.workflows?.find((w) => w.id === id);
    return found ? structuredClone(found) : null;
  }

  upsertWorkflow(workflow: Workflow): void {
    this.#assertOpen();
    if (!this.#wfp.workflows) this.#wfp.workflows = [];
    const clone = structuredClone(workflow);
    const idx = this.#wfp.workflows.findIndex((w) => w.id === clone.id);
    if (idx >= 0) this.#wfp.workflows[idx] = clone;
    else this.#wfp.workflows.push(clone);
    this.touch("workflows");
  }

  deleteWorkflow(id: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.workflows) return false;
    const before = this.#wfp.workflows.length;
    this.#wfp.workflows = this.#wfp.workflows.filter((w) => w.id !== id);
    const changed = this.#wfp.workflows.length < before;
    if (changed) this.touch("workflows");
    return changed;
  }

  // ── Tools ─────────────────────────────────────────────────────────────
  getTools(): Tool[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.tools ?? []);
  }

  getTool(toolId: string): Tool | null {
    this.#assertOpen();
    const found = this.#wfp.tools?.find((t) => t.tool_id === toolId);
    return found ? structuredClone(found) : null;
  }

  upsertTool(tool: Tool): void {
    this.#assertOpen();
    if (!this.#wfp.tools) this.#wfp.tools = [];
    const clone = structuredClone(tool);
    const idx = this.#wfp.tools.findIndex((t) => t.tool_id === clone.tool_id);
    if (idx >= 0) this.#wfp.tools[idx] = clone;
    else this.#wfp.tools.push(clone);
    this.touch("tools");
  }

  deleteTool(toolId: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.tools) return false;
    const before = this.#wfp.tools.length;
    this.#wfp.tools = this.#wfp.tools.filter((t) => t.tool_id !== toolId);
    const changed = this.#wfp.tools.length < before;
    if (changed) this.touch("tools");
    return changed;
  }

  // ── Knowledge ─────────────────────────────────────────────────────────
  getKnowledgePacks(): KnowledgePack[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.knowledge ?? []);
  }

  getKnowledgePack(name: string): KnowledgePack | null {
    this.#assertOpen();
    const found = this.#wfp.knowledge?.find((p) => p.name === name);
    return found ? structuredClone(found) : null;
  }

  upsertKnowledgePack(pack: KnowledgePack): void {
    this.#assertOpen();
    if (!this.#wfp.knowledge) this.#wfp.knowledge = [];
    const clone = structuredClone(pack);
    const idx = this.#wfp.knowledge.findIndex((p) => p.name === clone.name);
    if (idx >= 0) this.#wfp.knowledge[idx] = clone;
    else this.#wfp.knowledge.push(clone);
    this.touch("knowledge");
  }

  deleteKnowledgePack(name: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.knowledge) return false;
    const before = this.#wfp.knowledge.length;
    this.#wfp.knowledge = this.#wfp.knowledge.filter((p) => p.name !== name);
    const changed = this.#wfp.knowledge.length < before;
    if (changed) this.touch("knowledge");
    return changed;
  }

  // ── Data ──────────────────────────────────────────────────────────────
  getDataNames(): string[] {
    this.#assertOpen();
    return Object.keys(this.#wfp.data ?? {});
  }

  getDataEntry(name: string) {
    this.#assertOpen();
    const entry = this.#wfp.data?.[name];
    return entry ? structuredClone(entry) : null;
  }

  setDataEntry(name: string, entry: NonNullable<WfpFile["data"]>[string]): void {
    this.#assertOpen();
    if (!this.#wfp.data) this.#wfp.data = {};
    this.#wfp.data[name] = structuredClone(entry);
    this.touch("data");
  }

  deleteDataEntry(name: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.data || !(name in this.#wfp.data)) return false;
    delete this.#wfp.data[name];
    this.touch("data");
    return true;
  }

  // ── Sessions (kind: chat | automation per .wfp spec) ──────────────────
  getSessions(): ChatOrAutomationSession[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.sessions ?? []);
  }

  getSession(sessionId: string): ChatOrAutomationSession | null {
    this.#assertOpen();
    const found = this.#wfp.sessions?.find((s) => s.id === sessionId);
    return found ? structuredClone(found) : null;
  }

  upsertSession(session: ChatOrAutomationSession): void {
    this.#assertOpen();
    if (!this.#wfp.sessions) this.#wfp.sessions = [];
    const clone = structuredClone(session);
    const idx = this.#wfp.sessions.findIndex((s) => s.id === clone.id);
    if (idx >= 0) this.#wfp.sessions[idx] = clone;
    else this.#wfp.sessions.push(clone);
    // Prune to the newest MAX_SESSIONS by updated_at.
    if (this.#wfp.sessions.length > MAX_SESSIONS) {
      this.#wfp.sessions.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      this.#wfp.sessions = this.#wfp.sessions.slice(0, MAX_SESSIONS);
    }
    this.touch("sessions");
  }

  deleteSession(sessionId: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.sessions) return false;
    const before = this.#wfp.sessions.length;
    this.#wfp.sessions = this.#wfp.sessions.filter((s) => s.id !== sessionId);
    const changed = this.#wfp.sessions.length < before;
    if (changed) this.touch("sessions");
    return changed;
  }

  // ── Plan (top-level `plan` node — flat PlanEntry[]) ────────────────────
  getPlan(): PlanEntry[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.plan ?? []);
  }

  setPlan(plan: PlanEntry[]): void {
    this.#assertOpen();
    this.#wfp.plan = structuredClone(plan);
    this.touch("misc");
  }

  // ── Todos (top-level `todos` node — flat TodoEntry[]) ──────────────────
  getTodos(): TodoEntry[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.todos ?? []);
  }

  setTodos(todos: TodoEntry[]): void {
    this.#assertOpen();
    this.#wfp.todos = structuredClone(todos);
    this.touch("misc");
  }

  // ── Saved prompts (top-level `saved_prompts` node — SavedPrompt[]) ──────
  getSavedPrompts(): SavedPrompt[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.saved_prompts ?? []);
  }

  setSavedPrompts(prompts: SavedPrompt[]): void {
    this.#assertOpen();
    this.#wfp.saved_prompts = structuredClone(prompts);
    this.touch("misc");
  }

  // ── Rules (top-level `rules` node — user-created rules) ─────────────
  getRules(): Rule[] {
    this.#assertOpen();
    return _rulesGetAll(this.#wfp);
  }

  getRule(name: string): Rule | null {
    this.#assertOpen();
    return _rulesGetOne(this.#wfp, name);
  }

  upsertRule(rule: Rule): void {
    this.#assertOpen();
    _rulesUpsert(this.#wfp, rule);
    this.touch("misc");
  }

  deleteRule(name: string): boolean {
    this.#assertOpen();
    const deleted = _rulesDelete(this.#wfp, name);
    if (deleted) this.touch("misc");
    return deleted;
  }

  // ── LLM logs (top-level `logs` node — LLMLogEntry[]) ─────────────────
  getLogs(): LLMLogEntry[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.logs ?? []);
  }

  getLog(logId: string): LLMLogEntry | null {
    this.#assertOpen();
    const found = this.#wfp.logs?.find((l) => l.id === logId);
    return found ? structuredClone(found) : null;
  }

  /** Append one LLM log entry, pruning to the newest MAX_LOGS. */
  appendLog(entry: LLMLogEntry): void {
    this.#assertOpen();
    if (!this.#wfp.logs) this.#wfp.logs = [];
    this.#wfp.logs.push(structuredClone(entry));
    if (this.#wfp.logs.length > MAX_LOGS) {
      this.#wfp.logs.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      this.#wfp.logs = this.#wfp.logs.slice(0, MAX_LOGS);
    }
    this.touch("logs");
  }

  // ── Pause Promises ────────────────────────────────────────────────────
  registerPause(
    pauseId: string,
    resolve: (value: unknown) => void,
    reject: (reason: Error) => void,
  ): void {
    this.#assertOpen();
    this.#pendingPauses.set(pauseId, {
      resolve,
      reject,
      registeredAt: Date.now(),
    });
    this.touch();
  }

  resolvePause(pauseId: string, value: unknown): boolean {
    this.#assertOpen();
    const p = this.#pendingPauses.get(pauseId);
    if (!p) return false;
    this.#pendingPauses.delete(pauseId);
    this.touch();
    p.resolve(value);
    return true;
  }

  hasPendingPause(pauseId: string): boolean {
    return this.#pendingPauses.has(pauseId);
  }

  pendingPauseCount(): number {
    return this.#pendingPauses.size;
  }

  // ── Privacy entity counter ────────────────────────────────────────────
  nextPrivacyEntityId(): number {
    this.#assertOpen();
    this.touch();
    return ++this.#privacyEntityCounter;
  }

  currentPrivacyEntityCount(): number {
    return this.#privacyEntityCounter;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────
  /** Register a hook that runs at the START of close(), before the session is
   *  marked closed. Used by auto-save to do a final flush while the document
   *  is still readable (exportWfpSnapshot asserts the session is open). */
  onBeforeClose(hook: CloseHook): void {
    if (this.#closed) {
      void hook();
      return;
    }
    this.#beforeCloseHooks.push(hook);
  }

  onClose(hook: CloseHook): void {
    if (this.#closed) {
      void hook();
      return;
    }
    this.#closeHooks.push(hook);
  }

  async close(): Promise<void> {
    if (this.#closed) return;

    // Run pre-close hooks while the session is still open (final flush).
    for (const hook of this.#beforeCloseHooks) {
      try {
        await hook();
      } catch (e) {
        console.error("[WorkspaceSession] before-close hook error:", e);
      }
    }

    this.#closed = true;

    // Reject any pending pause Promises so awaiting tools fail cleanly.
    for (const [, p] of this.#pendingPauses) {
      try {
        p.reject(
          new Error("Workspace session closed before pause was resolved"),
        );
      } catch {
        // Promise was already settled — ignore.
      }
    }
    this.#pendingPauses.clear();

    // Run user-registered close hooks (SSE cleanup, in-flight runs, etc.).
    for (const hook of this.#closeHooks) {
      try {
        await hook();
      } catch (e) {
        console.error("[WorkspaceSession] close hook error:", e);
      }
    }

    // Scrub the secret. The WfpFile itself becomes unreachable once the
    // session is removed from the store; the GC reclaims it. There is no
    // need to walk and zero its fields.
    this.#secret = null;
    this.#privacyEntityCounter = 0;
  }

  // ── Snapshot for persistence (M11) ────────────────────────────────────
  /** Deep clone of the .wfp for re-encryption and save. */
  exportWfpSnapshot(): WfpFile {
    this.#assertOpen();
    return normalizeWfp(structuredClone(this.#wfp));
  }

  /** The encryption secret. `null` if the session was opened without one. */
  getSecret(): string | null {
    return this.#secret;
  }

  /** Replace the encryption secret (changing a workspace's password), or pass
   *  `null` to make it plaintext (required before sharing). The caller is
   *  responsible for re-persisting with the new secret. */
  changeSecret(newSecret: string | null): void {
    this.#assertOpen();
    this.#secret = newSecret;
    for (const s of ALL_SECTIONS) this.#dirtySections.add(s);
    this.touch();
  }

  // ── Guard ─────────────────────────────────────────────────────────────
  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("WorkspaceSession is closed");
    }
  }
}
