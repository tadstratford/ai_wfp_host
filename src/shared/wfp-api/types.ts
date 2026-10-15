// wfp-api — runtime types.
//
// File-format types (WfpFile, Message, etc.) live in wfp-format. This file
// adds the runtime-only types: the envelope that wraps parameter values, the
// WFP_API interface itself, and the LLM transport contract.

import type {
  FormContent,
  KnowledgePack,
  Message,
  TodoEntry,
  TodoStatus,
  TodoType,
} from "wfp-format";
import type {
  EmailStatus,
  InboundEmail,
  InboundEmailAttachment,
} from "@backend/core/workspace/emailInbox/types";

// ─────────────────────────────────────────────────────────────────────────────
// Typed envelope
// ─────────────────────────────────────────────────────────────────────────────

export type MetaType =
  | "string"
  | "number"
  | "boolean"
  | "csv"
  | "json_array"
  | "json_object"
  | "json_cells"
  | "text";

export interface MetaData {
  type: MetaType;
  rowCount?: number;
  columns?: string[];
  length?: number;
  /** Optional provenance tag (e.g. "user_data:tasks", "node:custom_tool").
   *  Informational; runners may set or read this but it has no semantic
   *  effect on parameter resolution. */
  source?: string;
}

export interface TypedEnvelope<T = unknown> {
  _meta: MetaData;
  data: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Messages emitted at runtime
// ─────────────────────────────────────────────────────────────────────────────

/** A message emitted during a workflow run, before the runner renders it. */
export interface RunMessage {
  role: "tool" | "system" | "error" | "voice" | "user";
  source: string;
  nodeLabel?: string;
  markdown?: string;
  html?: string;
  voice?: string;
  /** Name of a template for re-renderable interactive output. */
  template?: string;
  /** Data passed to the template for rendering. */
  template_data?: unknown;
  table?: Message["table"];
  chart?: Message["chart"];
  form?: Message["form"];
  json?: Message["json"];
  data?: Message["data"];
  timestamp: string;
}

/** Argument shape accepted by `api.addMessage`. */
export interface AddMessageInput {
  /** Explicit message id; when omitted the host generates one. */
  id?: string;
  role?: "tool" | "system" | "error";
  markdown?: string;
  html?: string;
  voice?: string;
  /** Name of a template to render the message as (re-renderable with HTMX). */
  template?: string;
  /** Data passed to the template for rendering. */
  data?: unknown;
  table?: Message["table"];
  chart?: Message["chart"];
  form?: Message["form"];
  json?: Message["json"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat turns (flattened view of a chat session's messages)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatTurn {
  turn_id: string;
  workflow_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report context (host-supplied; grounds a report in its workspace + run)
// ─────────────────────────────────────────────────────────────────────────────

/** One data file that fed the current run, for the report's source manifest. */
export interface ReportDataFile {
  /** Source filename or data-entry name. */
  name: string;
  /** Row count if tabular, else null. */
  rowCount: number | null;
  /** First 16 hex chars of the SHA-256 of the file content at run time. */
  contentHash: string;
}

/**
 * Canonical context for a report, supplied by the host runner. Every field is
 * baked into the self-contained report HTML at generation time — the report
 * must never call back to the app, so this is the only moment the host data is
 * available.
 *
 * `provenance` reflects THIS run: "ai-assisted" if any node called an AI
 * classifier, else "deterministic". Resolving the emails requires an admin
 * lookup, so this method is async.
 */
export interface ReportContext {
  workspace: string;
  period: string | null;
  /** ISO 8601 timestamp captured when the context is read. */
  generatedAt: string;
  workflowName: string;
  workflowId: string | null;
  dataFiles: ReportDataFile[];
  provenance: "deterministic" | "ai-assisted";
  llmModel: string | null;
  /** Email of the user who ran the workflow; null if unresolved. */
  runByEmail: string | null;
  /** Email of the workspace owner; null if unresolved. */
  ownerEmail: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pause / resume
// ─────────────────────────────────────────────────────────────────────────────

/** What `api.pauseForInput` shows to the user. */
export interface PausePrompt {
  markdown?: string;
  html?: string;
  form?: FormContent;
}

/** The user's response. Form submissions arrive as a field map. */
export type PauseResult =
  | { kind: "text"; value: string }
  | { kind: "form"; values: Record<string, unknown> }
  | { kind: "cancelled" };

// ─────────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The api.* surface
// ─────────────────────────────────────────────────────────────────────────────

/** The `api` object exposed to custom tool code. */
/** Fields accepted when creating a todo via `api.todos.add`. */
export interface TodoInput {
  label: string;
  /** Pre-filled session instruction, e.g. "/wf-build expense review". */
  instruction?: string;
  /**
   * Click behavior: "manual" is a checklist item; "workflow" runs `workflowId`
   * and completes from the run's sign-off. Defaults to "manual".
   */
  type?: TodoType;
  /** Target workflow id for `type: "workflow"` todos. */
  workflowId?: string;
  /**
   * The named run that produced this todo (e.g. "Qtr 2 Close"). If omitted,
   * the host fills it from the reserved parameter `todo_wf_instance_name`.
   */
  instanceName?: string;
  /** A single free-form string for additional grouping/analytics. */
  tag?: string;
  /** Optional target/due date (ISO `YYYY-MM-DD`). Display only. */
  dueDate?: string;
  /** Free-form human notes. Documentation only — never passed to a run. */
  notes?: string;
  /** Estimated effort in hours (may be fractional). Display only. */
  hours?: number;
  /** "build" | "data" | "knowledge" | "review" | "general". */
  category?: string;
  /** "planner" | "user" | "audit" | "system" | "session:<id>". */
  source?: string;
}

// ── General Ledger views (host capability; see docs/GL_SPEC.md) ─────────────
// Defined here (not imported from backend) so the vendored interface stays
// self-contained. Mirror of backend/core/gl/types.ts shapes.
export interface GLEntityView {
  id: string; code: string; name: string;
  is_primary: boolean; is_elimination: boolean;
  parent_entity_id: string | null; active: boolean;
}
export interface GLAccountView {
  account: string; account_type?: string | null; description?: string | null;
  active: boolean; account_number?: string | null;
}
export interface GLTrialBalanceRow {
  account: string; account_type?: string | null;
  debit: number; credit: number; balance: number;
}
export interface GLHeaderView {
  id: string; entity_id: string; date: string; period: string;
  transaction_type: string | null; num: string | null; name: string | null;
  memo: string | null; source: string; source_session_id: string | null;
}
/** A workspace's active dimension slot (configured in settings.dimensions). */
export interface GLDimensionView {
  key: "d1" | "d2" | "d3" | "d4";
  label: string;
  scope: "BS" | "pl" | "both" | "not_used";
  required: boolean;
}
export interface GLLineView {
  line_no: number; account: string; amount: number;
  debit: number | null; credit: number | null;
  /** Dimension values keyed by the workspace's active dimension label
   *  (e.g. `{ "Class": "Retail", "Location": null }`). Empty if none configured. */
  dims: Record<string, string | null>; memo: string | null;
}
export interface GLPostLineInput {
  account: string; amount?: number; debit?: number; credit?: number;
  /** Dimension values keyed by active dimension label (case-insensitive),
   *  e.g. `{ Class: "Retail" }`. Unknown labels are ignored with a warning. */
  dims?: Record<string, string>; memo?: string;
}
export interface GLPostInput {
  entityId: string; date: string; transactionType?: string;
  num?: string; name?: string; memo?: string;
  source?: "manual" | "opening" | "allocation" | "elimination";
  lines: GLPostLineInput[];
}

export interface EmailSendInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string;
  attachments?: { filename: string; content: string }[];
}

export interface EmailSendResult {
  success: boolean;
  message: string;
}

export interface WFP_API {
  /**
   * Host-only identifiers, optional. Set by multi-user / multi-workspace
   * runners (e.g. the hosted app) so tool code can build session-scoped
   * URLs or look up per-workspace state. Single-user runners (spa,
   * spa-voice) leave both `undefined`; tool code must handle that.
   */
  sessionId?: string;
  databaseId?: string;

  // ── Tier 1 — Core ────────────────────────────────────────────────────────
  getParameter(name: string): unknown;
  getParameterMeta(name: string): MetaData | undefined;
  setParameter(name: string, value: unknown): void;
  setData(name: string, value: unknown): Promise<void>;
  addMessage(msg: AddMessageInput): void;

  fetch(url: string, options?: FetchOptions): Promise<FetchResult>;

  /**
   * MCP bridge — host-only. Lets custom tool code call MCP tools registered
   * with the host's aggregator. `callMcp(server, tool, args)` is the flat core;
   * `mcp` is namespaced sugar (`api.mcp.qbo.qbo_pnl_report({...})`). Present
   * only in runners that host an MCP aggregator (the hosted app); call
   * defensively via `api.callMcp?.(...)` / `api.mcp?`. The host enforces a tool
   * policy — read/analysis tools plus constructive planning writes are allowed;
   * destructive/admin tools throw when invoked here.
   */
  callMcp?(server: string, tool: string, args?: Record<string, unknown>): Promise<unknown>;
  mcp?: {
    [server: string]: {
      [tool: string]: (args?: Record<string, unknown>) => Promise<unknown>;
    };
  };

  /**
   * General ledger — the per-user system of record. Declared for Phase 4 and
   * not yet wired by any runner, so tool code must guard with `api.gl?` and
   * handle its absence. All access is through these controlled, validated
   * methods — there is no raw-SQL query() by design. `post()` validates balance
   * at the header and throws on failure. Provenance (source_session_id) is set
   * by the runtime, not by tool code. See docs/GL_SPEC.md.
   */
  gl?: {
    entities(): Promise<GLEntityView[]>;
    accounts(): Promise<GLAccountView[]>;
    trialBalance(opts: {
      asOf: string; entityIds?: string[]; includeEliminations?: boolean;
    }): Promise<GLTrialBalanceRow[]>;
    journals(limit?: number): Promise<{ header: GLHeaderView; lines: GLLineView[] }[]>;
    /** The workspace's active (configured) dimensions, in slot order. */
    dimensions(): Promise<GLDimensionView[]>;
    /** Post a balanced journal. Returns the new header id plus any non-blocking
     *  warnings (e.g. a required dimension left blank, an unknown dim label). */
    post(journal: GLPostInput): Promise<{ headerId: string; warnings: string[] }>;
    upsertEntity(e: {
      code: string; name: string; isPrimary?: boolean; isElimination?: boolean; parentEntityId?: string;
    }): Promise<{ entityId: string }>;
    /** Update an entity's fields by id. */
    updateEntity(id: string, fields: {
      name?: string; isPrimary?: boolean; isElimination?: boolean; parentEntityId?: string | null; active?: boolean;
    }): Promise<void>;
    /** Delete an entity by id. Throws if the entity has journal entries. */
    deleteEntity(id: string): Promise<void>;
    clear(opts?: { entityId?: string }): Promise<void>;
  };

  /**
   * Financial Planning & Analysis — the optional Planning module. EVERYTHING
   * lives in the workspace document (a dedicated `fpa` data entry): config +
   * the ledger tuples + the materialized cube. No Supabase. All access is
   * through these controlled methods. Money crosses this boundary in dollars.
   * Declared for Phase 4; not yet wired by any runner. When wired, present only
   * when the `wfp_fpa` module is enabled; the methods throw a helpful error
   * otherwise. See docs/FPA_design.md.
   */
  fpa?: {
    // config reads
    settings(): Promise<FpaSettingsView>;
    accounts(): Promise<FpaAccountView[]>;
    dimensions(): Promise<FpaDimensionView[]>;
    scenarios(): Promise<FpaScenarioView[]>;
    periods(): Promise<FpaPeriodView[]>;
    reports(): Promise<FpaSavedReportView[]>;
    // config writes (ids assigned by the host)
    upsertAccount(a: FpaAccountInput): Promise<{ actId: number }>;
    deleteAccount(actId: number): Promise<void>;
    upsertDimension(d: { key: string; name: string }): Promise<{ key: string }>;
    upsertMember(
      dimKey: string,
      m: { id?: number; code?: string; desc: string; sort_order?: number },
    ): Promise<{ id: number }>;
    upsertEntity(e: { id?: number; code?: string; name: string }): Promise<{ id: number }>;
    upsertCurrency(cur: { id?: number; code: string }): Promise<{ id: number }>;
    upsertScenario(
      s: { scenario_id?: number; code?: string; description: string; sort_order?: number },
    ): Promise<{ scenarioId: number }>;
    upsertPeriod(p: FpaPeriodView): Promise<{ periodId: number }>;
    saveReport(def: { report_id?: string; name: string; pov: FpaReportPovView }): Promise<{ reportId: string }>;
    deleteReport(reportId: string): Promise<void>;
    // load (named workspace data files → ledger tuples)
    loadJournals(
      dataFileNames: string[],
      opts: { scenarioId: number; entityId?: number },
    ): Promise<{ journals: number; lines: number; errors: string[]; warnings: string[] }>;
    setRate(currencyId: number, periodId: number, rate: number): Promise<void>;
    clear(): Promise<void>;
    // map / build (control & materialize report data)
    setScenarioFlag(
      opts: { jvId: number; scenarioId: number; on: boolean },
    ): Promise<{ rebuiltRows: number }>;
    buildReportData(
      opts: { scenarioId: number; periodRange?: { start: number; end: number } },
    ): Promise<{ rows: number; ms: number }>;
    // report (read the cube; dollars out)
    report(pov: FpaReportPovView): Promise<FpaReportResultView>;
    cube(pov: { scenarioIds: number[]; periodIds?: number[]; entityIds?: number[]; actIds: number[] }): Promise<FpaCubeRowView[]>;
    journals(filter: { periodId?: number; entityId?: number; jvId?: number }): Promise<FpaLedgerLineView[]>;
  };

  // ── Tier 2 — Universal ───────────────────────────────────────────────────
  getKnowledge(name: string): string | null;
  /**
   * Read a skill's markdown content by name, or null if not found. Host-only
   * (present in the hosted app; absent in minimal runners) — call defensively
   * via `api.getSkill?.(name)`.
   */
  getSkill?(name: string): string | null;
  /** List available skills (name + description). Host-only, like `getSkill`. */
  listSkills?(): { name: string; description?: string }[];
  /**
   * Read a workspace rule's markdown content by name, or null if not found.
   * Host-only — call defensively via `api.getRule?.(name)`.
   */
  getRule?(name: string): string | null;
  /** List available workspace rules (name + description). Host-only, like `getRule`. */
  listRules?(): { name: string; description?: string }[];
  /** Full workspace rules (name + description + content) — host-only. */
  getRules?(): { name: string; description?: string; content: string }[];
  /**
   * The workflow this session is running (id, name, description). Host-only;
   * call defensively via `api.getActiveWorkflow?.()`. Lets a workflow step read
   * its own definition (e.g. the workflow_audit node reads `## Rules` from the
   * workflow description).
   */
  getActiveWorkflow?(): { id: string; name: string; description: string } | null;
  /**
   * Resolve the workspace's classifier (Jev) API key, or null when none is
   * configured. Host-only — call defensively via `api.getClassifierKey?.()`.
   * Lets a workflow step run the classifier rule audit as a fast pre-gate.
   */
  getClassifierKey?(): Promise<string | null>;
  getChatHistory(limit?: number): ChatTurn[];
  /**
   * Serialized output of the current run — all messages this workflow produced
   * (markdown + json + table + rendered html), joined into one text block.
   * Host-only; call defensively via `api.getStream?.()`. Used by the terminal
   * `workflow_audit` to judge the entire stream against the workspace rules.
   */
  getStream?(): string;
  appendChat(turn: { role: "user" | "assistant" | "system"; content: string }): void;
  pauseForInput(prompt: PausePrompt): Promise<PauseResult>;

  renderReport(html: string, filename: string): void;

  /**
   * Render a registered widget/template (e.g. "account-table") with the given data
   * and deliver it as a downloadable report (download + open-in-new-tab + inline
   * preview). Same rendering path the chat `chat_download(widget=…)` uses.
   */
  renderWidget(name: string, data: unknown, filename?: string): void;

  /**
   * Workspace todo list (the top-level `todos` node). Lets tool code read and
   * manage tasks — e.g. a "Close Manager" workflow that inspects workspace
   * state and emits the period's task list.
   */
  todos: {
    /** All todos, newest sort order last. Optionally filter by status. */
    list(filter?: { status?: TodoStatus }): TodoEntry[];
    /** Create a todo (defaults: status "pending", source "system"). */
    add(todo: TodoInput): TodoEntry;
    /** Patch a todo's status and/or label. Returns false if not found. */
    update(id: string, patch: { status?: TodoStatus; label?: string }): boolean;
    /** Mark a todo done. Returns false if not found. */
    complete(id: string): boolean;
    /** Delete a todo. Returns false if not found. */
    remove(id: string): boolean;
  };

  /**
   * Read-only view of the workspace's workflows. Lets a tool map workflow
   * names to ids — e.g. a "Close Manager" tool turning an LLM's plain-English
   * assignments into `type: "workflow"` todos linked by `workflowId`.
   */
  workflows: {
    list(): { id: string; name: string; description: string }[];
  };

  /**
   * Host-only inbound-email inbox + outbound send. Lets tool code read,
   * triage (set status), delete, and send emails. Present in the hosted app;
   * absent (`undefined`) in minimal runners — call defensively via `api.emails?.`.
   */
  emails?: {
    /** List this workspace's archived inbound emails, newest first. */
    list(filter?: { status?: EmailStatus; limit?: number }): Promise<InboundEmail[]>;
    /** Fetch a single inbound email by id. */
    get(emailId: string): Promise<InboundEmail | null>;
    /** Set an inbound email's processing status. Optionally record a failure
     *  reason (stored on the email) when the status is "failed". */
    setStatus(emailId: string, status: EmailStatus, failReason?: string | null): Promise<boolean>;
    /** Delete an inbound email (attachments cascade). */
    delete(emailId: string): Promise<boolean>;
    /** List the attachments of an inbound email (metadata + base64 content). */
    listAttachments(emailId: string): Promise<InboundEmailAttachment[]>;
    /** Fetch a single attachment (including base64 content) by id. */
    getAttachment(attachmentId: string): Promise<InboundEmailAttachment | null>;
    /** Decode an attachment's base64 content to readable text. */
    getAttachmentContent(attachmentId: string): Promise<string>;
    /** Send an outbound email (Resend). Replies route to `replyTo`. */
    send(input: EmailSendInput): Promise<EmailSendResult>;
    /** Stage a reply WITHOUT sending. The email agent reads the staged
     *  `__outbound_reply` draft after the workflow's audit node and sends it
     *  only if the audit passes (fail-closed). Use in email-triggered
     *  workflows instead of `send` for replies. */
    draftReply(input: EmailSendInput): Promise<boolean>;
  };

  /**
   * Host-supplied canonical report context (workspace, period, source
   * manifest, run provenance, run-by + owner emails) for baking into a
   * self-contained report at generation time. Present in multi-workspace
   * runners such as the hosted app; absent in minimal runners. Report tools
   * should call it defensively: `const ctx = await api.getReportContext?.()`.
   */
  getReportContext?(): Promise<ReportContext>;

}

// ─────────────────────────────────────────────────────────────────────────────
// FP&A views (api.fpa.*) — config has no money; report/cube/ledger money is dollars
// ─────────────────────────────────────────────────────────────────────────────

export type FpaAccountType = "input" | "subtotal" | "formula";

export interface FpaSettingsView {
  base_currency: string;
}

export interface FpaAccountView {
  act_id: number;
  code: string;
  description: string;
  type: FpaAccountType;
  group_name: string;
  rollup?: string | null;
  formula?: string | null;       // human form, by name
  formula_code?: string | null;  // machine form, by act_id (what the engine evals)
  unit?: string | null;
  sort_order: number;
  active: boolean;
}

/** Account upsert: omit act_id to create. `formula_code` is derived from
 *  `formula` by the host; callers normally pass only `formula`. */
export interface FpaAccountInput {
  act_id?: number;
  code?: string;
  description: string;
  type: FpaAccountType;
  group_name?: string;
  rollup?: string | null;
  formula?: string | null;
  formula_code?: string | null;
  unit?: string | null;
  sort_order?: number;
  active?: boolean;
}

export interface FpaDimMemberView { id: number; code: string; desc: string; sort_order: number }
export interface FpaDimensionView { key: string; name: string; members: FpaDimMemberView[] }
export interface FpaEntityView { id: number; code: string; name: string }
export interface FpaCurrencyView { id: number; code: string }
export interface FpaScenarioView { scenario_id: number; code: string; description: string; sort_order: number }
export interface FpaPeriodView { period_id: number; year: number; month: string; quarter: string; description: string }
export interface FpaSavedReportView { report_id: string; name: string; pov: FpaReportPovView }

export interface FpaReportPovView {
  reportType: "pnl-month" | "pnl-dim" | "scenario-compare" | "pivot" | "matrix" | "saved";
  savedId?: string;
  scenarioIds: number[];
  periodIds?: number[];
  entityIds?: number[];
  dimFilters?: Record<string, number[]>;
  colAxis?: { type: "period" } | { type: "dimension"; dimKey: string } | { type: "scenario" };
  colDims?: string[];
  rowDims?: string[];
  accountIds?: number[];
  variance?: boolean;
}

export interface FpaReportColumnView { label: string; kind?: "leaf" | "subtotal" | "total"; account?: FpaAccountView }
export interface FpaReportRowView { label: string; account?: FpaAccountView; kind?: "leaf" | "subtotal" | "total"; values: (number | null)[] }
export interface FpaReportResultView { name: string; columns: FpaReportColumnView[]; rows: FpaReportRowView[] }

export interface FpaCubeRowView {
  scenario_id: number; period_id: number;
  dim1_id: number; dim2_id: number; dim3_id: number;
  entity_id: number;
  amt: Record<number, number>; // dollars per act_id
}

export interface FpaLedgerLineView {
  jv_id: number; period_id: number; entity_id: number;
  act_id: number; dim1_id: number; dim2_id: number; dim3_id: number;
  amount: number; // dollars
  jv_desc: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  /** Max 60 seconds. Enforced by wfp-api regardless of caller's value. */
  timeout?: number;
}

export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  /** JSON-parsed when possible; otherwise equals `text`. */
  data: unknown;
  text: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports the runner side cares about
// ─────────────────────────────────────────────────────────────────────────────

export type { KnowledgePack };
