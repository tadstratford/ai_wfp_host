# Workflow

> Last updated: 2026-10-14

Workflow definitions, graph operations, execution engine, and build pipeline. 47 files, ~4.5k lines.

> **Data & Dependency Model** — how tool inputs/outputs bind to one another and
> how cross-workflow data dependencies + staleness are tracked: see
> [`DATA_AND_DEPENDENCIES.md`](DATA_AND_DEPENDENCIES.md).

## Top-Level Files

| File | Purpose |
|---|---|
| `index.ts` | Barrel exports for CRUD operations, node operations, and execution functions. |
| `createWorkflow.ts` | Creates a new workflow. |
| `getWorkflows.ts` | Lists all workflows for a workspace. |
| `getWorkflowbyId.ts` | Fetches a single workflow by ID. |
| `getWorkflowSummary.ts` | Gets a summarized view of a workflow. |
| `updateWorkflow.ts` | Updates a workflow's definition. |
| `updateWorkflowDetails.ts` | Updates workflow metadata (name, description). |
| `deleteWorkflow.ts` | Deletes a workflow. |
| `copyWorkflow.ts` | Creates a copy of an existing workflow. |
| `executeWorkflow.ts` | Entry point for workflow execution. Sets up execution context, runs nodes, handles completion. |
| `executor.ts` | Core execution engine. Linear node traversal, tool resolution, parameter preparation, envelope handling, pause/resume, guardrails. |
| `graphWorkflow.ts` | Graph operations: add/remove/reorder nodes, compute linear execution order, step assignment. |
| `testNode.ts` | Run a single node in isolation for testing. |
| `updatePosition.ts` | Updates a node's visual position on the canvas. |
| `workflowVersions.ts` | Workflow versioning support. |
| `changelog.ts` | Workflow change log tracking. |

## Subdirectories

| Directory | Purpose |
|---|---|
| `node/` | Node-level operations: splice, update approvals/budget/email/chat/name/parameters/variables, helpers. |
| `process_manager/` | Build pipeline engine. Processes chat messages through Plan → Wire → Test stages. |
| `run/` | Native tool implementations. Each subdirectory is one tool that can be used in workflows. |
| `utils/` | Utility functions: `templateVariables.ts` — resolves `{{variable}}` templates in node configs. |

### `process_manager/`

| File | Purpose |
|---|---|
| `build-pipeline.ts` | Core build pipeline: receives chat messages, plans the workflow from the tool catalog, wires nodes, tests. |
| `build-pipeline-types.ts` | Types for the build pipeline stages. |
| `build-test.ts` | Test stage of the build pipeline. |
| `postMortem.ts` | Post-mortem analysis after workflow execution failures. |
| `sessionSpec.ts` | `specFromSession()` — flattens a chat session into a worked-example spec for the "Save as workflow" conversion. |

### `node/`

| File | Purpose |
|---|---|
| `index.ts` | Node operation barrel exports. |
| `_helpers.ts` | Internal node manipulation helpers. |
| `spliceNewNode.ts` | Inserts a new node into the workflow graph. |
| `updateNodeApprovals.ts` | Configures approval rules on a node. |
| `updateNodeBudget.ts` | Configures budget constraints on a node. |
| `updateNodeChatMsg.ts` | Configures chat message settings on a node. |
| `updateNodeEmail.ts` | Configures email notification settings on a node. |
| `updateNodeName.ts` | Renames a node. |
| `updateNodeParameters.ts` | Updates a node's tool parameters. |
| `updateNodeVariables.ts` | Updates a node's output variable mappings. |

### `run/`

| Directory | Purpose |
|---|---|
| `run_MCP/` | `run_MCP` tool — bridges native workflow execution to MCP server tools. |
| `workflow_start/` | `workflow_start` tool — workflow initialization. |
| `workflow_end/` | `workflow_end` tool — workflow completion and cleanup. |
| `workflow_audit/` | `workflow_audit` tool — final fail-closed audit: one Jev classifier call checks the whole run stream against `wfp.rules` + the workflow description. |
| `chat_download/` | `chat_download` tool — delivers a downloadable file (HTML report or a rendered widget via `widget` + JSON `data`). |
| `send_email/` | `send_email` tool — send an outbound email via Resend. |

> Inbox triage tools (`email_list`, `email_get`, `email_set_status`,
> `email_delete`) were removed from `workflow/run/`; inbound email access now goes
> through the WFP_API `api.emails.*` namespace (`src/shared/wfp-api/types.ts`) and
> the `emails` capability (`src/capabilities/emails/`).

## Execution Flow

1. `executeWorkflow()` orchestrates the run: loads workflow, initializes execution state in session, saves snapshot
2. `executeWorkflowActions()` computes linear node order (via `getLinearOrder()`), validates guardrails (max 50 nodes, 30 min timeout, 500 messages)
3. For each node, `executeNode()`:
   - Routes MCP tools through `run_MCP` bridge
   - Calls `prepareNodeParams()` to merge defaults + config + parameters, resolve templates, wrap in `TypedEnvelope`
   - Runs the tool via `runTool()` with a 5-minute timeout
4. Supports pause/resume: `resumeWorkflow()` and `resumeAfterPause()` handle both legacy and PauseSignal-based pauses
5. On completion, generates a session summary asynchronously

## Build pipeline (plan → wire → test)

`runBuildPipeline()` in `process_manager/build-pipeline.ts` turns a request into a workflow in three stages: **plan** (one LLM call → `BuildPlan` of nodes composed from the existing tool catalog), **wire** (create workflow + nodes + terminal `workflow_audit`), **test** (integration run). `BuildPipelineParams.plannerPrompt` selects the planner template — `pipeline/planner` for natural-language builds, `pipeline/planner-convert` for "save chat session as workflow". The pipeline streams per-step timing and LLM-call detail into the build session.

## Save chat session as workflow

A chat session can be converted into a reusable workflow. The chat orchestrator appends each turn's tool calls (`{tool, args}`) to `session.metadata.toolCalls`; `specFromSession()` (`process_manager/sessionSpec.ts`) flattens that into a worked-example spec, and `runBuildPipeline` with `plannerPrompt: "pipeline/planner-convert"` generalizes it into a plan of catalog-tool nodes. Entry point: the "Save as workflow" button in the chat header (`sessions/saveAsWorkflow.tsx`, routes `POST /sessions/save-as-workflow{/build}`). Judgment steps use the typed Classifier `judge_data`.

## Key Exports

```ts
// CRUD
export { createWorkflow, getWorkflows, getWorkflowById, updateWorkflow,
         updateWorkflowDetails, deleteWorkflow, copyWorkflow };

// Graph
export { addWorkflowNode, updateWorkflowNode, removeWorkflowNode,
         updateNodePositions, assignStepOrder, getLinearOrder, reorderWorkflowNodes };

// Execution
export { executeWorkflow, executeWorkflowActions, resumeWorkflow,
         resumeAfterPause, resumeScheduledWorkflow, testNode };

// Node config
export * from "./node";
```

## Two Execution Paths

When a workflow node runs, the tool is executed via one of two paths:

| Path | When | How |
|---|---|---|
| **Direct native import** | Built-in tools (`workflow_start`, `workflow_end`, accounting, etc.) | `getToolFunction()` returns a direct function reference from `workflow/run/`. Called with WFP_API context. Zero protocol overhead. |
| **`run_MCP` proxy** | External/third-party MCP tools | `executeNode()` rewrites the node to `tool_id: "run_MCP"` with `{ serverName, toolName, args }` when `isMcpTool()` is true **and** the id is not a native tool — native tools take precedence (e.g. native `chat_download` vs the MCP `chat_download`). Dispatches through `aggregator.callTool()`. One universal bridge for all MCP servers. |

The `run_MCP` universal bridge works because all MCP tools share the same JSON-RPC envelope: `name` + `arguments` → `{ content: [...] }`. Adding a new MCP server makes its tools immediately available to both chat (LLM discovers via `listTools()`) and runner (workflow nodes invoke via `run_MCP` with `{ serverName, toolName, args }`).

## Related Modules

- `src/core/tools/registry.ts` — Tool resolution for workflow nodes
- `src/mcp/aggregator.ts` — MCP tool routing during execution
- `src/chat/vers_8/orchestrator.ts` — Chat-driven workflow building
- `src/workspace/WorkspaceSession.ts` — All state mutations go through the session

## Removed: file-based QBO ledger

The file-based QBO ledger was removed (the `wfp.qbo` node, `api.qbo.*`, the
`qbo_ledger_*` / `qbo_journal_*` MCP tools, and the QBO tab). QBO reports are
now parsed into normalized data tables on upload/paste
(`<name>_qbo_<gl|journal|coa>`). Legacy-workspace note: saved workflows whose
custom tools still reference `api.qbo.*` or nodes wired to `qbo_ledger_*` /
`qbo_journal_*` MCP tools will fail at runtime with a "tool not found" / API
error. Rebuild those workflows against the parsed `*_qbo_*` data tables or the
live QBO tools (`qbo_accounts_list`, `qbo_gl_review`, …). The deprecated
`qbo` field is stripped from `.wfp` files on load/save.
