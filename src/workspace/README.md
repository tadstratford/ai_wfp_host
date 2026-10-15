# Workspace

> Last updated: 2026-09-27

Workspace state management — the in-memory `.wfp` document model, session store, lifecycle, and all workspace-scoped data (knowledge, rules, todos, settings, user data, logs).

## Core Concept

A **workspace** is a `.wfp` file (JSON document) containing workflows, data, knowledge packs, sessions, todos, and tools. The `WorkspaceSession` class is an in-memory, decrypted container for a `.wfp` file. All read and write operations go through it. The `.wfp` file itself and the encryption secret never persist — they live only in RAM.

## Top-Level Files

| File | Purpose |
|---|---|
| `index.ts` | Ensures the workspace data directory exists on startup. |
| `WorkspaceSession.ts` | Core class. Encapsulates a `.wfp` file in memory. Provides typed accessors for all sections (workflows, tools, knowledge, data, sessions, plan, todos). Tracks dirty state, handles pause promises, privacy entity counter, lifecycle hooks. |
| `workspaceSessionStore.ts` | Singleton store mapping userId → WorkspaceSession. Lookup by userId, databaseId, or workspaceId. |
| `workspaceStore.ts` | Higher-level workspace listing and metadata store. |
| `workspaceLifecycle.ts` | Lifecycle operations: open (disk or Supabase), create, save, save-as, close. Handles encryption/decryption. |
| `importFromFile.ts` | Import a `.wfp` (or individual items from one) from disk. |
| `access.ts` | Workspace access control and permissions. |
| `crypto.ts` | Encryption/decryption for `.wfp` files. Used when saving/loading encrypted workspaces. |
| `dependencyGraph.ts` | Dependency graph for workspace entities (workflows, tools, data). See also `src/workflow/DATA_AND_DEPENDENCIES.md` for the full data & dependency model. |
| `itemCounts.ts` | Cached counts of workspace items (workflows, sessions, data entries, etc.). |
| `nextAction.ts` | Computes suggested next actions based on workspace state. |
| `preview.ts` | Generates a preview/summary of a workspace (for the workspace picker). |
| `shareWorkflow.ts` | Workspace sharing: generates share links, manages expiry, cleanup. |
| `todoBuckets.ts` | Todo categorization into buckets (overdue, today, upcoming, etc.). |
| `todoStore.ts` | Todo persistence operations. |
| `workflowGrants.ts` | Workflow access grants management. |
| `workflowIndex.ts` | Index of workflows per workspace (names, status, counts) for the picker. |
| `workflowStatus.ts` | Workflow status tracking (draft, active, archived). |

## Subdirectories

| Directory | Purpose |
|---|---|
| `context/` | Context building for LLM prompts. `index.ts` (barrel), `summarize.ts` (session summary generation), `userContext.ts` (user context aggregation). |
| `dashboard/` | Dashboard data aggregation: workspace metrics, activity feed, overview data. |
| `emailInbox/` | Inbound email inbox (Supabase-backed). `address.ts` (per-workspace `wf-<key>.<secret>` address CRUD + timing-safe auth + allowlist), `store.ts` (email/attachment archive CRUD), `types.ts`. See `emailInbox/README.md`. |
| `knowledge/` | Knowledge pack CRUD: `index.ts` (barrel), `store.ts` (persistence), `loader.ts` (loading), `privacy.ts` (privacy-map name + merge helpers), `template.ts` (templates), `auditLog.ts` (audit trail), `successFactors.ts` / `successFactorAudit.ts` (success metrics). Note: the knowledge page was replaced by the skills UI; privacy-map knowledge packs remain. |
| `overview/` | Workspace overview: `workspaceState.ts` (state computation), `glassBoxNarrator.ts` (Glass Box narrative generation). |
| `session/` | Session management: `index.ts` (barrel), `actions/` (session actions), `messages/` (message CRUD, link message generation), `sessions/` (session CRUD and bulk operations), `tasks/` (task management), `analyseRun.ts` (post-run analysis). |
| `logs/` | LLM API call log storage: `index.ts` (`writeLog`/`getLog` into the workspace session), `formatter.ts` (markdown rendering), `helpers.ts` (build log entries). |
| `settings/` | Settings management: `index.ts` (barrel), `settings.ts` (settings store with LLM config), `parameterHelpers.ts` (parameter merge, get/set), `settings.json` (default settings). |
| `wfp/` | WFP API runtime for tools. `index.ts` (barrel), `createAPI.ts` (constructs WFP_API from session), `types.ts` (API surface types, TypedEnvelope, PauseSignal types), `PauseSignal.ts` (pause signal class for tool code). |

## WorkspaceSession Lifecycle

```
User opens workspace
  → workspaceLifecycle.openDiskWorkspace() or openSupabaseWorkspace()
  → Reads .wfp file → decrypts (if encrypted) → constructs WorkspaceSession
  → Registers in workspaceSessionStore

All operations go through WorkspaceSession methods:
  session.getWorkflows(), session.upsertWorkflow(), session.setTodos(), etc.
  Each mutation calls touch() → increments mutation counter → marks dirty

## .wfp Data Model

The `.wfp` document has these top-level nodes:

| Node | Type | Accessor | Description |
|------|------|----------|-------------|
| `metadata` | `Metadata` | `getMetadata()`, `updateMetadata()` | Workspace name, period, format version |
| `workflows` | `Workflow[]` | `getWorkflows()`, `upsertWorkflow()`, `deleteWorkflow()` | Workflow definitions |
| `tools` | `Tool[]` | `getTools()`, `upsertTool()`, `deleteTool()` | Custom JavaScript tools |
| `data` | `Record<string, DataEntry>` | `getDataEntry()`, `setDataEntry()`, `deleteDataEntry()` | CSV/JSON/file data |
| `knowledge` | `KnowledgePack[]` | `getKnowledgePacks()`, `upsertKnowledgePack()`, `deleteKnowledgePack()` | Markdown knowledge documents |
| `rules` | `Rule[]` | `getRules()`, `getRule()`, `upsertRule()`, `deleteRule()` | Workspace rules & preferences (surfaced as "Rules" in the UI). Each has `name`, `description`, `scope`, `tags`, `content` (markdown body with `## Instructions` and `## Tools needed` sections). Injected into chat and the workflow builder. |
| `sessions` | `Session[]` | `getSessions()`, `upsertSession()`, `deleteSession()` | Chat and automation sessions |
| `plan` | `PlanEntry[]` | `getPlan()`, `setPlan()` | Flat plan entries (host-specific) |
| `todos` | `TodoEntry[]` | `getTodos()`, `setTodos()` | Task items (host-specific) |

### LLM logs (stored in the `.wfp`)

LLM API call logs are part of the `.wfp` document — written through
`WorkspaceSession.appendLog()`, so they persist with the workspace (encrypted at
rest) rather than in a separate table.

Each `LLMLogEntry` captures one HTTP call to an LLM provider, written inside
`src/shared/llm/providers/index.ts` at the `callProvider()` boundary (including
masked `rawRequest`/`rawResponse` for privacy-masking verification).

Retention is capped at **50 entries per workspace** (`MAX_LOGS` in
`src/workspace/logs/index.ts`; oldest pruned on append). A log detail page at
`/app/logs/:logId` renders a single entry as markdown (via
`src/workspace/logs/formatter.ts`).

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID for the log entry (also the table `log_id` PK) |
| `sessionId` | `string` | Session that triggered the LLM call |
| `provider` | `string` | LLM provider (e.g. `"anthropic"`, `"deepseek"`) |
| `model` | `string` | Model ID |
| `mode` | `string` | Chat mode: `"plan"` or `"build"` |
| `providerResponseId` | `string?` | Provider's own response ID (Anthropic's `data.id`, DeepSeek's `data.id`) for cross-referencing |
| `durationMs` | `number` | Wall-clock duration of the API call |
| `systemPrompt` | `string` | Full system prompt sent to the LLM |
| `messages` | `Array<{role, content}>` | Messages sent to the LLM at this step |
| `responseText` | `string` | Full LLM response text for this step |
| `inputTokens` | `number?` | Input tokens used in this step |
| `outputTokens` | `number?` | Output tokens generated in this step |
| `toolCalls` | `Array<{name, args}>` | Tool calls made by the LLM in this step |
| `success` | `boolean` | Whether the call succeeded |
| `error` | `string?` | Error message if the call failed |
| `rawRequest` | `string?` | Full JSON request body sent to the API (pretty-printed in log viewer) |
| `rawResponse` | `string?` | Full JSON response body from the API (pretty-printed in log viewer) |
| `created_at` | `string` | ISO 8601 timestamp |

One LLM log entry is created per **step** (individual HTTP API call) — the Classifier
routing call and each LLM build-loop iteration, up to the loop's cap. All calls pass
`sessionId` for correlation.

Log entries are written inside `callProvider()` via `writeLog()`
(`src/workspace/logs/index.ts`), which appends to the workspace session. The `logId`
is returned; the provider layer fires a `setLogHook` callback which the chat handler
uses to post "view log" links inline in the chat. No log links appear in the right
panel.

Auto-save (debounced):
  onMutate hook → triggers saveActiveWorkspace() after idle period
  saveActiveWorkspace() exports WfpFile snapshot → encrypts → writes to storage
  markSaved() syncs mutation counter → isDirty() returns false

User closes workspace
  → workspaceLifecycle.closeActiveWorkspace()
  → session.close() → runs close hooks → scrubs secret → removes from store
```

## Key Exports

```ts
// WorkspaceSession class — the core in-memory container
export class WorkspaceSession { ... }

// Lifecycle
export { openSupabaseWorkspace, openDiskWorkspace, createAndOpenWorkspace,
         saveActiveWorkspace, saveAsNewWorkspace, closeActiveWorkspace };

// WFP API (for tool code)
export { createWFP_API } from "./wfp";
export { PauseSignal, isPauseSignal } from "./wfp";
```

## Related Modules

- `src/workflow/` — Workflow CRUD called from workspace session methods
- `src/mcp/servers/` — MCP servers read/write through workspace session
- `src/shared/wfp-api/` — Shared WFP API surface (mirrors workspace/wfp/ for external use)

