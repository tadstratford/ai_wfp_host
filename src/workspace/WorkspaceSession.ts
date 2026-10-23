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
  ProvenanceEvent,
  ProvenanceAction,
  PrivacyMask,
} from "wfp-format";
import type { Rule } from "wfp-format/rule";
import type { LLMLogEntry } from "wfp-format/logs";
import { getRules as _rulesGetAll, getRule as _rulesGetOne, upsertRule as _rulesUpsert, deleteRule as _rulesDelete } from "../rules/store";
import { randomUUID } from "node:crypto";
import { hashValue } from "./hash";
import { getProducerContext } from "./producer";

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
  | "misc"
  | "provenance"
  | "privacy_mask";

const ALL_SECTIONS: WfpSectionName[] = [
  "metadata",
  "workflows",
  "tools",
  "data",
  "knowledge",
  "sessions",
  "logs",
  "misc",
  "provenance",
  "privacy_mask",
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
  // Content-addressed payloads pending write to the content store (keyed by
  // hash). Drained by the auto-save flush so the "Time Machine" can reconstruct
  // historical node values. Only small nodes are buffered (large `data` payloads
  // are excluded).
  readonly #pendingContent = new Map<string, unknown>();

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
    this.#recordChange("metadata", "upsert", this.#wfp.metadata);
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
    this.#recordChange(`workflow:${clone.id}`, "upsert", clone);
    this.touch("workflows");
  }

  deleteWorkflow(id: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.workflows) return false;
    const before = this.#wfp.workflows.length;
    this.#wfp.workflows = this.#wfp.workflows.filter((w) => w.id !== id);
    const changed = this.#wfp.workflows.length < before;
    if (changed) {
      this.#recordChange(`workflow:${id}`, "delete", null);
      this.touch("workflows");
    }
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
    this.#recordChange(`tool:${clone.tool_id}`, "upsert", clone);
    this.touch("tools");
  }

  deleteTool(toolId: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.tools) return false;
    const before = this.#wfp.tools.length;
    this.#wfp.tools = this.#wfp.tools.filter((t) => t.tool_id !== toolId);
    const changed = this.#wfp.tools.length < before;
    if (changed) {
      this.#recordChange(`tool:${toolId}`, "delete", null);
      this.touch("tools");
    }
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
    this.#recordChange(`knowledge:${clone.name}`, "upsert", clone);
    this.touch("knowledge");
  }

  deleteKnowledgePack(name: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.knowledge) return false;
    const before = this.#wfp.knowledge.length;
    this.#wfp.knowledge = this.#wfp.knowledge.filter((p) => p.name !== name);
    const changed = this.#wfp.knowledge.length < before;
    if (changed) {
      this.#recordChange(`knowledge:${name}`, "delete", null);
      this.touch("knowledge");
    }
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
    this.#recordChange(`data:${name}`, "upsert", this.#wfp.data[name]);
    this.touch("data");
  }

  deleteDataEntry(name: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.data || !(name in this.#wfp.data)) return false;
    delete this.#wfp.data[name];
    this.#recordChange(`data:${name}`, "delete", null);
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
    this.#recordChange(`session:${clone.id}`, "upsert", clone);
    this.touch("sessions");
  }

  deleteSession(sessionId: string): boolean {
    this.#assertOpen();
    if (!this.#wfp.sessions) return false;
    const before = this.#wfp.sessions.length;
    this.#wfp.sessions = this.#wfp.sessions.filter((s) => s.id !== sessionId);
    const changed = this.#wfp.sessions.length < before;
    if (changed) {
      this.#recordChange(`session:${sessionId}`, "delete", null);
      this.touch("sessions");
    }
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
    this.#recordChange("plan", "upsert", this.#wfp.plan);
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
    this.#recordChange("todos", "upsert", this.#wfp.todos);
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
    this.#recordChange("saved_prompts", "upsert", this.#wfp.saved_prompts);
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
    this.#recordChange(`rule:${rule.name}`, "upsert", _rulesGetOne(this.#wfp, rule.name));
    this.touch("misc");
  }

  deleteRule(name: string): boolean {
    this.#assertOpen();
    const deleted = _rulesDelete(this.#wfp, name);
    if (deleted) {
      this.#recordChange(`rule:${name}`, "delete", null);
      this.touch("misc");
    }
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
    this.#recordChange(`log:${entry.id}`, "upsert", entry);
    this.touch("logs");
  }

  // ── Provenance (top-level `provenance` node — append-only ledger) ─────
  getProvenance(): ProvenanceEvent[] {
    this.#assertOpen();
    return structuredClone(this.#wfp.provenance ?? []);
  }

  getProvenanceEvent(id: string): ProvenanceEvent | null {
    this.#assertOpen();
    const found = this.#wfp.provenance?.find((e) => e.id === id);
    return found ? structuredClone(found) : null;
  }

  /** Append a pre-built event to the "Time Machine" ledger. Append-only — the
   *  caller is responsible for a correct `prevHash` chain. Prefer
   *  `recordCheckpoint` / the internal mutation recorder for normal use. */
  appendProvenanceEvent(event: ProvenanceEvent): void {
    this.#assertOpen();
    this.#pushProvenanceEvent(event);
  }

  /** Append a named checkpoint marker to the ledger (a "kind: checkpoint"
   *  event — a navigation landmark, not a snapshot). */
  recordCheckpoint(opts: { label?: string; period?: string; rationale?: string } = {}): void {
    this.#assertOpen();
    const prev = this.#tailHash();
    const producer = getProducerContext();
    this.#pushProvenanceEvent({
      id: randomUUID(),
      prevHash: prev,
      kind: "checkpoint",
      action: "upsert",
      target: "checkpoint",
      newContentHash: null,
      actor: this.#userId,
      producer: producer.producer,
      producerVersion: producer.producerVersion,
      eventAt: new Date().toISOString(),
      period: opts.period,
      label: opts.label,
      rationale: opts.rationale,
    });
  }

  /** Record a period-close-style checkpoint that ALSO captures the full `data`
   *  section (the books) so the workspace can be reconstructed as-of this point
   *  in time. The data snapshot is buffered and written to the content store on
   *  the next flush; its hash is stored on the checkpoint as `snapshotHash`. */
  recordSnapshot(opts: { label?: string; period?: string } = {}): void {
    this.#assertOpen();
    const data = this.#wfp.data ?? {};
    const snapshotHash = hashValue(data);
    this.#pendingContent.set(snapshotHash, data);
    const producer = getProducerContext();
    this.#pushProvenanceEvent({
      id: randomUUID(),
      prevHash: this.#tailHash(),
      kind: "checkpoint",
      action: "upsert",
      target: "checkpoint",
      newContentHash: null,
      actor: this.#userId,
      producer: producer.producer,
      producerVersion: producer.producerVersion,
      eventAt: new Date().toISOString(),
      period: opts.period,
      label: opts.label ?? `Snapshot — ${new Date().toISOString().slice(0, 10)}`,
      snapshotHash,
    });
  }

  /** Hash of the current ledger tail (null when empty) — the chain link. */
  #tailHash(): string | null {
    const events = this.#wfp.provenance ?? [];
    return events.length > 0 ? hashValue(events[events.length - 1]) : null;
  }

  #pushProvenanceEvent(event: ProvenanceEvent): void {
    if (!this.#wfp.provenance) this.#wfp.provenance = [];
    this.#wfp.provenance.push(structuredClone(event));
    this.touch("provenance");
  }

  /** Centralized mutation recorder — appends a hash-chained "change" event for
   *  a node add/delete/alter. Called by every mutating accessor (the single
   *  chokepoint for tamper-evident capture). */
  #recordChange(target: string, action: ProvenanceAction, newValue: unknown): void {
    const producer = getProducerContext();
    const contentHash = newValue === null ? null : hashValue(newValue);
    if (contentHash !== null && !target.startsWith("data:")) {
      this.#pendingContent.set(contentHash, newValue);
    }
    this.#pushProvenanceEvent({
      id: randomUUID(),
      prevHash: this.#tailHash(),
      kind: "change",
      action,
      target,
      newContentHash: contentHash,
      actor: this.#userId,
      producer: producer.producer,
      producerVersion: producer.producerVersion,
      eventAt: new Date().toISOString(),
    });
  }

  /** Drain buffered content-addressed payloads (hash → value) and clear the
   *  buffer. Called by the auto-save flush after a successful save. */
  drainPendingContent(): Array<{ hash: string; value: unknown }> {
    const out = Array.from(this.#pendingContent.entries()).map(([hash, value]) => ({ hash, value }));
    this.#pendingContent.clear();
    return out;
  }

  // ── Privacy mask (top-level `privacy_mask` node) ───────────────────────
  getPrivacyMask(): PrivacyMask {
    this.#assertOpen();
    return structuredClone(this.#wfp.privacy_mask ?? { entries: [] });
  }

  setPrivacyMask(mask: PrivacyMask): void {
    this.#assertOpen();
    this.#wfp.privacy_mask = structuredClone(mask);
    this.#recordChange("privacy_mask", "upsert", this.#wfp.privacy_mask);
    this.touch("privacy_mask");
  }

  /** Current value of the node addressed by a provenance `target` string
   *  (e.g. "workflow:<id>", "data:<name>", "metadata"). Returns null when the
   *  node doesn't exist. Used by the Time Machine to diff "then vs now". */
  getNodeValue(target: string): unknown {
    this.#assertOpen();
    const idx = target.indexOf(":");
    const kind = idx === -1 ? target : target.slice(0, idx);
    const name = idx === -1 ? "" : target.slice(idx + 1);
    switch (kind) {
      case "data": return this.#wfp.data?.[name] ?? null;
      case "workflow": return this.#wfp.workflows?.find((w) => w.id === name) ?? null;
      case "tool": return this.#wfp.tools?.find((t) => t.tool_id === name) ?? null;
      case "knowledge": return this.#wfp.knowledge?.find((p) => p.name === name) ?? null;
      case "rule": return this.#wfp.rules?.find((r) => r.name === name) ?? null;
      case "session": return this.#wfp.sessions?.find((s) => s.id === name) ?? null;
      case "log": return this.#wfp.logs?.find((l) => l.id === name) ?? null;
      case "metadata": return this.#wfp.metadata ?? null;
      case "plan": return this.#wfp.plan ?? null;
      case "todos": return this.#wfp.todos ?? null;
      case "saved_prompts": return this.#wfp.saved_prompts ?? null;
      case "privacy_mask": return this.#wfp.privacy_mask ?? null;
      default: return null;
    }
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
