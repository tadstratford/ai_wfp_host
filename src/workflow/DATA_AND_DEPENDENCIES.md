# Data & Dependency Model

How WorkflowPeople keeps workflows correct and honest about what depends on
what. Two layers work together: a **step I/O contract** (within a workflow) and
a **data/workflow dependency graph** (across workflows).

---

## Layer 1 — Step I/O contract

Workflows are composed from the existing tool catalog (native + MCP tools). Each
step's data flow is declared in the build plan: which tool runs, which arguments
it takes, and where each argument comes from (`{{dataFile}}`, `{{result}}`, a
literal, or `{{userMessage}}`).

### Declaration

- A node's `tool_parameters` hold the step's arguments. A `{{name}}` value
  references a loaded data file, `{{result}}` (the previous MCP step's output),
  or `{{userMessage}}`.
- MCP tools declare inputs but no outputs. The `run_MCP` bridge writes each
  step's result to the `result` parameter, so `{{result}}` always means "the
  previous step's output".

### The contract

A `{{name}}` reference must have a producer: a loaded data file, `{{result}}`,
or `{{userMessage}}`. The plan is validated before it is built, and any node
whose tool id doesn't resolve to a known catalog tool fails the build.

The contract is enforced in `src/workflow/process_manager/build-pipeline.ts`:

| Check | When | What it catches | Effect |
|---|---|---|---|
| `findUnresolvedDataInputs()` | plan time | a `{{name}}` reference has **no** provider | warning before approval, then re-plan / fail |
| `validatePlanTools()` | build time | a node's `toolId` is not a known catalog tool | fails the build with a clear message |

Supporting prompt contracts live in `src/chat/prompts/pipeline/planner.md`,
`planner-convert.md`, and `modify-planner.md`.

---

## Layer 2 — Data & workflow dependency graph

Across workflows, the dependency unit is the **workspace data file**, not the
in-memory parameter. `src/workspace/workflowStatus.ts` builds a `reads`/`writers`
map by inspecting every workflow's tools and nodes:

- **Writers** — steps that persist a data file (the `save_data` tool, which calls
  `api.setData(name)`).
- **Readers** — node `tool_parameters` that reference `{{name}}`.

From that it derives, for each workflow:

- **`depends_on`** — auto-assigned (and persisted on the `Workflow`) when a
  workflow reads data another workflow writes. `src/workspace/dependencyGraph.ts`
  computes topological execution order and downstream/dependent sets.
- **Status** — `not_run` / `running` / `complete` / **`stale`** / `blocked` / `ready`.
  A completed workflow turns **`stale`** when any data file it reads was edited
  **after** its last run (`edited_at > completed_at`), and staleness **cascades**
  through `depends_on`. `src/workspace/nextAction.ts` then surfaces "rerun to
  pick up the latest data".

### Intermediate outputs are in-memory

`{{result}}` and other session parameters live only for the current run; they
are recomputed on every execution and do **not** participate in cross-workflow
dependency or staleness. Only `api.setData()` — which persists into the
workspace `data` map — is a durable, tracked output.

### Chat plan data flow (the "one engine")

The chat composer (`src/chat/plan/`) wires **pre-built MCP tools** together, and
MCP tools declare inputs but **no outputs**. Three pieces close that gap:

- **Output contract** — `src/chat/plan/outputs.ts` declares each tool's output
  `type` and whether it's `tabular` (`getToolOutput`, `saveTypeFor`).
- **`{{result}}` resolution** — `resolveParamTemplates()` in `src/workflow/executor.ts`
  resolves `{{name}}` recursively through a node's `tool_parameters` *before* the
  `run_MCP` bridge stringifies args, JSON-encoding object values. This is how
  `save_data(value="{{result}}")` receives a producer's object as a string.
- **Tabular flattening** — `extractTable()` in `src/data/table.ts` unwraps a
  producer's wrapper object (`{ rows }` / `{ groups }`, flattening `key`+`measures`)
  into a flat array. `save_data`/`set_param` run it when `type="json_array"` so a
  persisted result is a real table, not a text blob.

---

## Where each piece lives

| Concern | File |
|---|---|
| Tool input/output types | `src/types/tool.ts` (`Tool`, `ToolInput`, `ToolOutput`) |
| Build-plan node types | `src/workflow/process_manager/build-pipeline-types.ts` |
| Plan-level producer check | `build-pipeline.ts` → `findUnresolvedDataInputs()` |
| Build-time tool resolution check | `build-pipeline.ts` → `validatePlanTools()` |
| Planner prompt contract | `src/chat/prompts/pipeline/planner.md` |
| Workflow DAG (order / downstream / stale) | `src/workspace/dependencyGraph.ts` |
| Status + data staleness + cascade | `src/workspace/workflowStatus.ts` |
| "Rerun stale" next-action | `src/workspace/nextAction.ts` |
| Data persistence (`setData` → `data` map) | `src/workspace/wfp/createAPI.ts` → `setData` |
| Pre-built tool output contract | `src/chat/plan/outputs.ts` (`getToolOutput`, `saveTypeFor`) |
| Structured-arg synthesis (measures/group_by) | `src/chat/plan/args.ts` |
| `{{result}}` recursive resolution | `src/workflow/executor.ts` → `resolveParamTemplates()` |
| Tabular flattening (`rows`/`groups` → table) | `src/data/table.ts` → `extractTable()` |
