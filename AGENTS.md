# AGENTS.md

Guidance for agents working in this repo. Read before starting non-trivial work.

## Canonical docs (read these first)

- `docs/architecture.md` — modules, layers, request flow.
- `docs/system-of-record/` — the system-of-record plan and document shape:
  - `overview.md` — the vision.
  - `plan.md` — the **canonical forward-looking plan**; sections carry a status
    (`done` / `in progress` / `planned` / `later`) and a checkbox list. Track new
    capabilities here so they are not forgotten.
  - `wfp-nodes.md` — the top-level `.wfp` document shape (nodes marked `(new)` /
    `(planned)`).
- `docs/mcp-servers.md`, `docs/credits-and-billing.md`.

## Pending capabilities

- **Generic deterministic data tools** (`profile_data`, `classify_data`,
  `split_data`, plus `reconcile_relationship` / `aggregate_data`) — see
  `docs/data-quality-pipeline.md`. Status: `in progress`. Data quality is a *tool*
  the LLM selects (given user message + rules + schema), not a load-time pipeline.
  Before adding tabular logic, prefer a deterministic engine + explicit-parameter
  tool over LLM arithmetic or load-time column inference.
- **Storytelling data-review (chat v10)** — a "story" framing for financial data
  (`persona → setup → status → gap → plan → execute → resolution`), with an
  addressable display-element registry the LLM/Jev can reference. See
  `docs/data-storytelling.md`. Status: `in progress` (steps 1–4 shipped read-only;
  steps 5–7 report-only).
- **Rule-aware orchestrator (chat v11)** — a plan-first engine (`ORCHESTRATOR=vers_11`)
  that turns every request into a materialized, maintained `TurnPlan` of typed
  steps (data / communication / control). Workspace rules are selected by a Jev
  funnel (tags → description), auto-classified into an enforcement tier
  (deterministic / classified / audit), and enforced as data steps placed **before**
  the write-approval gate — a flagged rule blocks the write. See `docs/data-storytelling.md`
  (communication as a skill) and the plan section `docs/system-of-record/plan.md`.
  Status: `in progress` (plan engine shipped; Jev result verification + full story
  beats deferred).

## Adding a feature

Follow the repo's module checklist: `types` → `WorkspaceSession` accessors →
store/schema → routes → UI → chat/MCP sync. The `adding-a-feature` skill
(`.agents/skills/adding-a-feature/SKILL.md`) has the full list. New `.wfp`
top-level nodes must be documented in `docs/system-of-record/wfp-nodes.md`.

## Conventions

- Use `bun run typecheck` (`bun tsc --noEmit`) and `bun test <path>` to verify.
- Follow `no-fallbacks`: throw a clear error on missing config; never silently
  substitute a default.
- Deterministic tabular engines are locked by **golden fixtures** in
  `src/data/golden/` (hand-verified reference answers). When tabular arithmetic
  changes, update the golden numbers rather than weakening the test.
