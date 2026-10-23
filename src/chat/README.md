# Chat

> Last updated: 2026-10-23

AI chat orchestration layer — receives user messages, runs deterministic gates, routes through Jev (Classifier), then produces a plan (a deterministic one-step "trivial plan", a Jev-composed node-plan, or an LLM-composed plan) and executes it inline; novel/bespoke work falls through to an LLM tool-calling loop.

Two orchestrator versions are selectable via `process.env.ORCHESTRATOR` (default `vers_8`):
- **vers_8** — Jev + deterministic regex classify intent and compose a template plan; the LLM fills args and only falls back to a build loop for novel work. Determinism/cost-first.
- **vers_9** — the LLM plans and executes through the build loop, then **Jev verifies the result** (`satisfies`/`complete`/`accurate` in `vers_9/verify.ts`). Completeness/accuracy-first. See `vers_9/`.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Barrel. Re-exports `handleMessage` and `parseCommand` from vers_8. |
| `context/chatHistory.ts` | Builds chat history context for LLM prompts from session messages. |
| `context/manifest.ts` | Builds a data inventory manifest for LLM context. |
| `prompts/loader.ts` | Loads and parses `.md` prompt templates using gray-matter frontmatter. |
| `prompts/operational/summarizer.md` | Prompt template for session/workflow summarization. |
| `prompts/operational/workflow-description.md` | Prompt template for describing workflows. |
| `prompts/pipeline/planner.md` | Prompt template for the build pipeline planner stage. |
| `prompts/pipeline/planner-convert.md` | Prompt template for converting a chat session into a workflow. |
| `prompts/pipeline/modify-planner.md` | Prompt template for the modify-workflow planner. |
| `plan/types.ts` | Node-plan types (`NodePlan`, `PlanStep`, `ComposeResult`, `ValidateResult`). |
| `plan/planner.ts` | Swappable planner facade — `PlanRequest`/`PlanResult`/`Planner` interface + registry + `getPlanner()` (select via `CHAT_PLANNER`; defaults to `cascade`). |
| `plan/cascade.ts` | **Default planner** — a declarative shape registry (`SHAPES`). Jev classifies each shape's `noul`s (fan-out derived from the registry) + a data-file `choice`; each shape's builder assembles its template (`qbo-statement`, `qbo-read`, `planning-variance`, `analysis`) with deterministic args + one LLM arg-fill. `registerShape()` is the extension point for future (external MCP) shapes. Bespoke reports fall back with `preferLoop`. |
| `plan/jevStep.ts` | Baseline planner — wraps the original `composePlan` + `validatePlan` (Jev step-by-step). |
| `plan/llm.ts` | Universal fallback planner — one `callProvider` JSON call emits an ordered plan over the full tool roster (with param schemas); normalized + fail-closed (unknown tool / missing required arg → fallback). |
| `plan/compose.ts` | The `jev-step` internals — Jev selects ordered steps one `choice` per step; fills args (data-file resolution, `{{result}}`/persisted-name wiring, structured-arg synthesis, LLM JSON fill) plus a report-tail synthesis safety net. |
| `plan/validate.ts` | Shared validator — Jev gates a plan (`satisfies` + `safe` nouls); fails closed on missing required args. |
| `plan/args.ts` | Deterministic structured-arg synthesis (`matchColumnNames`, `synthesizeStructuredArgs`, `resolveDataName`) — fills `aggregate_data`'s `measures`/`group_by` from "sum X by Y" phrasing. |
| `plan/outputs.ts` | Thin wrapper over the MCP result-contract registry (`src/mcp/outputs.ts` → `resultContract`); `getToolOutput`, `saveTypeFor`. |
| `vers_8/index.ts` | Per-request handler: dedup, cancel, `setLogHook` wiring, `OrchestratorIO` construction, session status, SSE. |
| `vers_8/orchestrator.ts` | Request flow: deterministic gates → Jev routing → plan path (trivial one-step lane → `cascade` shape planner → `llm` planner → build loop; show `Steps` → write gate → execute) → build loop; also `resolveTrivialPlan`, `renderPlanSummary`, `auditChatPlan`, `runPlan`, `recordAnalysis`. |
| `vers_8/skillRouter.ts` | Jev (TypeSafe "Classifier") front-door router — one batched structured-decision call classifies the request (skills + nouls only; tools are derived from skills). |
| `vers_8/getSkillsPrompt.ts` | Loads system skill names/descriptions for routing (helper). |
| `vers_8/loop.ts` | Explicit while-loop (`runLoop()`): reason → act → feed back. `mcpToolsToProvider()`. |
| `vers_8/prompts.ts` | Dynamic system prompt builder (build + email modes): tool catalog, skills, rules, data inventory, WFP type vocab. |
| `vers_9/index.ts` | v9 handler — mirrors `vers_8/index.ts` (banner "v9", same log hook + SSE wiring). |
| `vers_9/orchestrator.ts` | v9 flow: Jev routing → LLM build loop (plans + executes) → `verifyResult` → persist. No regex/noul intent detection. |
| `vers_9/verify.ts` | Jev result verification — `satisfies`/`complete`/`accurate` nouls gate the LLM's output, cross-checked against the deterministic tools' computed output (`evidence`); fail-closed, privacy-masked. |

Supporting modules:

| Module | Role |
|---|---|
| `src/chat/extract/` | Deterministic parameter extraction (`extract.ts`, `schema.ts`, `dates.ts`). |
| `src/shared/typesafe/` | TypeSafe Classifier (Jev) HTTP client — sends `state` + typed `questions`, returns typed `answers`. |

## Architecture

vers_8 shifts the pipeline from "LLM plans everything" (v6) to "the Classifier routes and gates, the LLM composes only when needed."

### Request flow

```
                        rawMessage
                            │
        ┌───────────────────┴────────────────────┐
        │   DETERMINISTIC GATES (cheap, no LLM)   │
        └───────────────────┬────────────────────┘
                            │
  1. pendingWrite + "approve"?  ──yes──► re-run original request
  2. continuation ("continue")?  ──yes──► resume loop / re-run last
  3. follow-up ("by month")?     ──yes──► re-run last tool, re-extract params
                            │  (none matched)
                            ▼
              ┌───────────────────────────┐
              │  CLASSIFIER · JEV ROUTING  │  one TypeSafe "Classifier" call
              │  needs_tool? mutating?     │  (skills + nouls only — no tool /
              │  which skill?              │   workflow roster in the prompt)
              │  complexity? follow_up?    │
              └───────────────┬───────────┘
                              │  → decision {needsTool, mutating, complexity, followUp, selectedSkills}
                              │  → tools derived deterministically from skills' "## Tools needed"
                              ▼
        4. Jev follow_up ≥ 0.6?  ──yes──► re-run last tool (carry-forward)
                               │
                               ▼
                ┌───────────────────────────────────────┐
                │  PLAN PATH (single methodology)        │
                │  1. trivial one-step lane — read-only, │
                │     confident, params resolve (no Jev/ │
                │     LLM)                               │
                │  2. cascade shape registry (Jev fan-   │
                │     out + deterministic template)      │
                │  3. llm planner fallback (full LLM)    │
                └───────────────────┬───────────────────┘
                                    │ plan composed
                                    ▼
                ┌───────────────────────────────────────┐
                │  SHOW STEPS → HARD WRITE GATE          │
                │  plan has a write tool? → ask user     │──► stop, await approval
                └───────────────────┬───────────────────┘
                                    │ approved / read-only
                                    ▼
                ┌───────────────────────────────────────┐
                │  EXECUTE inline (executePlanInSession) │
                │  stream step-status → live checklist   │
                └───────────────────┬───────────────────┘
                           fallback │ (preferLoop / no plan)
                                    ▼
                ┌───────────────────────────────────────┐
                │  LLM BUILD LOOP (final fallback)      │
                │  explicit while-loop: reason → act    │
                └───────────────────────────────────────┘
```

The plan path is the **single methodology**: the orchestrator first tries a **trivial one-step plan** (`resolveTrivialPlan`) for a confident, read-only, single-tool request — the deterministic arg resolver produces a one-step plan with no Jev classify and no LLM. Otherwise it calls `getPlanner().plan(...)` (the `cascade` shape planner, or another strategy selected by `CHAT_PLANNER`), then shows the `Steps` list, gates approval, and runs `executePlanInSession`. A plan the active strategy can't produce or validate returns `{ kind: "fallback" }`; the orchestrator then retries with `llmPlanner` (unless `preferLoop` is set, which routes straight to the build loop), and only if that also falls back does the LLM loop run — so the plan path can never regress a request it can't handle.

### Skills-first routing & tool contracts

Routing is **skills-first**: Jev receives the skill catalog plus a few lightweight `noul`s (`needs_tool`, `mutating`, `complexity`, `follow_up`), along with the workspace's rule briefs and loaded data-file names — no tool list, no workflow list, so the routing prompt stays small but rule-aware (a rule can steer skill selection). Tools are derived deterministically afterward from the selected skills' `## Tools needed` sections (plus the always-available set in `orchestrator.ts`).

Two MCP-layer modules back the tool model:

- `src/mcp/outputs.ts` — the **result contract** registry. MCP tools only declare an *input* schema, so each server declares its tools' *output* via `declareResult(name, { metaType, tabular })` using the WFP `MetaType` vocabulary (`json_array`/`json_object`/`text`/…). `plan/outputs.ts` reads it through `resultContract()`.
- `src/mcp/capabilityIndex.ts` — a cached, startup-built index of skills → their declared tools, and tools → `{ server, description, inputSchema, output }`. The workflow planner consumes it (`buildMcpToolsSection`) so chat→workflow conversion sees each tool's input *and* output contract.

### Node-plan path (plan → show steps → gate → execute)

The plan path is **pluggable**: the orchestrator calls `getPlanner().plan(request)` (see `plan/planner.ts`) and consumes the `PlanResult` (`{ kind: "plan", plan }` vs `{ kind: "fallback", reason, preferLoop? }`). `CHAT_PLANNER=jev-step|cascade|llm` selects the strategy; the default is **`cascade`**. The orchestrator chains planners: if the active strategy returns `fallback` (and doesn't set `preferLoop`), it retries with `llmPlanner` over the full working roster before falling to the build loop.

**Cascade** (default) is a declarative **shape registry** (`SHAPES` in `cascade.ts`). Each shape declares the `noul`s that classify it, a `matches(flags)` predicate, and a `build(req, flags, ctx)` that emits the plan. The classifier fan-out and the dispatch loop are both derived from the registry, so adding a shape = adding one entry. Registered shapes:
- `qbo-statement` — `report_qbo_pnl`/`report_qbo_bs` → `chat_download` (dates + `summarize_column_by` via the extractor).
- `qbo-read` — a single targeted QBO read (`qbo_gl_review`, `qbo_ar_ap`, `qbo_duplicates`, …).
- `planning-variance` — `report_plan_variance` → `chat_download`.
- `analysis` — `get_data → aggregate_data → save_data(staging_*) → [check_data] → report_table → chat_download`, with a single LLM arg-fill for `group_by`/`measures`/`checks`/`title`/`detail_columns`. Error/audit requests ("analyze for errors") skip aggregation and emit `get_data → check_data`.

`registerShape()` is the extension point for future non-internal (external MCP) tool shapes.

**Bespoke reports** (custom dashboards/charts) can't be expressed by a fixed template, so `cascade` returns `{ kind: "fallback", preferLoop: true }` — the orchestrator skips `llmPlanner` and runs the build loop directly (which authors bespoke HTML per `report-authoring.md`). **Broad exploration** ("analyze this data", "review this data") does the same: when the `analysis` shape's `explore` noul fires without a specific `aggregate`/`judge`/`report`, it defers to the build loop — the loop explores the tables, runs per-row `judge_data` rule-compliance checks, and composes findings — instead of emitting a shallow `list_data`/`list_rules` inventory plan.

The other strategies are `jev-step` (the original `composePlan` → `validatePlan` step-by-step classifier) and `llm` (`llmPlanner`, the one-shot full-LLM plan used as the universal fallback).

A validated plan is **shown first as a numbered `Steps` list**, *then* the write-approval gate runs (so the user sees the plan before Approve/Cancel), then it executes inline via `executePlanInSession`, which walks the steps through `executeNode` so node progress streams into the chat session. After execution, `renderPlanSummary` emits a natural-language summary (skipped when the plan ends in `chat_download` — the Download button is the deliverable) and `auditChatPlan` runs a fail-closed `runStreamRuleAudit` against `wfp.rules` (mirroring the terminal `workflow_audit` of a built workflow).

**Clarification:** when a planner can't resolve a required argument, it returns `{ kind: "clarify", missing: ["toolId.param", …] }`. The orchestrator asks the user (a free-text question from `plan/clarify.ts`), stores `pendingClarification`, and ends the turn. On the reply it resolves each missing value and **stores it as a typed parameter in `session.parameters`** (`persistClarifiedParams`), then re-runs the request; the planner consumes those values by name via `PlanRequest.clarifiedParams` — the same typed-param convention as the workflow's `pauseForInput` form, rather than only re-parsing free text.

**Follow-up reuse:** `runPlan` records a rolling `analysisHistory` breadcrumb (source + saved `staging_*` summary + `group_by`) into `session.metadata`. A follow-up that back-references the prior result ("these findings", "put this into…", "the issues") reuses the prior source and, when a summary was saved, builds the report directly from it — skipping re-`get_data`/`aggregate_data`. `referencesPrior()` in `cascade.ts` is the matcher.

**`check_data`** (dataset-level checks, `src/capabilities/judge` + `src/shared/typesafe/judge.ts#checkDataset`) is the broad-check sibling of the per-row `judge_data`: it sends the whole (masked) table as one `state` and asks N `noul` questions in a single Jev call — one request instead of one-per-row — for "are any rows missing a GL Account?" style questions. `judge_data` remains for cases that need row-level results.

The executor resolves `{{result}}` recursively before the `run_MCP` bridge stringifies args (`resolveParamTemplates` in `src/workflow/executor.ts`, a thin wrapper over the shared `resolveTemplates` in `src/workspace/settings/parameterHelpers.ts`), so a producer's object output survives the JSON bridge — this is what makes `save_data(value="{{result}}")` chain correctly. The chat build loop uses the **same** resolver and convention: after each tool call it writes the tool's output into `session.parameters['result']` (mirroring `run_MCP`), so `{{result}}` resolves identically in chat and workflow.

### Inside the LLM build loop (`runLoop()`, `loop.ts`)

```
    messages (system prompt + history)
             │
        ┌────▼─────────────────────────────────────────┐
        │  REASON — one callProvider() LLM call         │
        └────┬─────────────────────────────────────────┘
             │
        did the model ask for a tool?
             │
        no ◄──┤                      yes
             │                          │
        (stop reason?)                  ▼
             │                 ┌──────────────────────┐
        truncated?             │  ACT — execute tool   │
        → hitCap, resume       │  via MCP aggregator   │
             │                 └──────────┬───────────┘
             │                            │
             │                    feed tool_result back
             │                    into messages
             │                            │
             │                            └────────► loop again (until maxIterations)
             ▼
       final reply
```

Two guardrails end the loop: **(1)** the model stops calling tools (natural end), **(2)** `maxIterations` reached (hard stop, then `executeLoop` auto-continues by resuming the transcript, up to a separate cap).

### Step → system mapping

| Step | Engine | Where |
|---|---|---|
| Continuation / follow-up / write-approval gates | Deterministic heuristics (regex, `Set`s) | `orchestrator.ts` |
| Jev routing (skill + tool + mutating + complexity) | **Classifier** (TypeSafe `jev-latest`) | `skillRouter.ts` `route()` — sees skills + rule briefs + data-file names |
| Parameter extraction (dates, numbers, enums) | Deterministic | `chat/extract/extract.ts`, `dates.ts` |
| Trivial one-step plan (read-only, confident, fully-resolved) | Deterministic (no Jev/LLM) | `resolveTrivialPlan()` + `fillFastPathArgs()` |
| Write gate | Deterministic (`looksMutating` + Jev `mutating` + the plan's own `WRITE_TOOLS` steps) | `orchestrator.ts` |
| Plan compose (shape → template → args) | **Classifier** (shape fan-out from the registry) + deterministic template + 1 LLM arg-fill; `preferLoop` → build loop | `plan/cascade.ts` (default) → `plan/llm.ts` fallback |
| Plan validate (satisfies + safe) | **Classifier** + deterministic missing-arg check | `plan/validate.ts` |
| Plan execute (inline, streamed) | Workflow executor | `executePlanInSession()` in `src/workflow/executor.ts` |
| Terminal summary | 1 small LLM render | `renderPlanSummary()` |
| Fail-closed rule audit | **Classifier** (`runStreamRuleAudit`) | `auditChatPlan()` |
| Build loop (final fallback; also the target of `preferLoop` for bespoke reports/dashboards) | **LLM** (tool-calling loop) | `loop.ts` `runLoop()` |

**In one sentence:** deterministic code and Jev (Classifier) decide *whether* the LLM is needed and *gate* it; every request runs as a plan — a deterministic one-step plan for confident reads, a Jev-composed node-plan for structured multi-step work — and only the remaining novel/bespoke work falls through to the LLM loop, whose tools are pre-filtered by the skills Jev selected.

## Log Hook Pattern

LLM call logging is owned by the provider layer, not the orchestrator. `src/shared/llm/providers/index.ts` exports a `setLogHook` function. `index.ts` wires it once per request:

```ts
setLogHook(async ({ logId, provider, model, inputTokens, outputTokens, kind }) => {
  const label = kind === "jev" ? "Jev call" : "LLM call";
  session = await addMessage({
    session, databaseId,
    html: `<div>${label} (${provider} — ${inputTokens}→${outputTokens} tok) — <a>view log</a></div>`,
  });
});
```

After each `callProvider` call the hook fires automatically. The Jev routing path is not a chat LLM call, so `skillRouter.ts` invokes the hook manually via `fireLogHook(...)` with `kind: "jev"`. The orchestrator **never** builds log link HTML — it just calls `callProvider` and processes responses.

## Tool-call recording & save-as-workflow

`finishLoop()` in `orchestrator.ts` extracts each turn's tool calls from the loop transcript and appends `{ at, tools:[{tool, args}] }` to `session.metadata.toolCalls`; the plan path records its steps the same way via `persistToolCalls()`. The "Save as workflow" flow (`sessions/saveAsWorkflow.tsx`, `POST /sessions/save-as-workflow{/build}`) reads that record via `specFromSession()` and re-runs `runBuildPipeline` with `plannerPrompt: "pipeline/planner-convert"` to produce a reusable, parameterized workflow from the session.

`OrchestratorIO.addMessage` takes a single object (`AddMessageArgs`: `{ markdown?, html?, json?, id? }`), and the MCP `AppHook.addMessage` shares that shape.

## Privacy masking

Both paths mask user data before it leaves the machine, using the same `privacy-map` / `privacy-map-automatic` knowledge packs (`loadPrivacyMap`).

- **LLM path** (`providers/index.ts`): `maskCallOptions` before send, `unmaskResult` after; plus catch-up discovery (`discoverRequestValues`) when tool results carry new names.
- **Jev path** (`skillRouter.ts`): masks only the user-derived `state` (`request`, `lastRequest`) with `maskText`, leaving skill/tool names (criteria) unmasked so Jev's `choice` answers key off real names and need no unmasking.

## Skill Format

Skills live in `src/core/skills/*.md` (system/app, read-only) and `src/capabilities/<name>/skills/*.md` (capability-owned). Workspace rules live in the `.wfp` document (`wfp.rules[]`) — surfaced in the UI as "Rules". Both share the same format:

```markdown
---
name: my-skill-name
description: Clear, concise summary of what this rule does.
scope: chat+workflow
tags: [reporting]
---

## Instructions
1. First procedural step...
2. Next action or code execution pattern...

## Tools needed
- `tool_name` — what it is used for
```

The `description` field is used in the routing prompt. The `## Tools needed` section declares which tools the skill expects. Workspace user skills (rules & preferences) are also injected into the workflow builder (`build-pipeline.ts` planner) and into the build/modify planners.

## Plan/Build/Email

Plan and Build are handled as chat **modes** (`buildSystemPrompt(mode, …)` in `prompts.ts`); the Jev router selects skills based on the user's request, and the core skills (`build`, `guardrails`, `report-authoring`, `data-handling`, etc.) live in `src/core/skills/`. The `mode` parameter is passed through for logging and prompt construction.

A third mode, **`email`**, is used by the headless email agent (`src/workspace/emailInbox/agent.ts`). It feeds an inbound email to `handleMessage(...)` as the user message; `prompts.ts` swaps in an autonomous, bounded system prompt and the orchestrator swaps the always-on `guardrails` skill for the email-mode skill set — no human confirmation, but only allowlisted outbound sends, no deletes, and a transcript.

## Related Modules

- `src/mcp/` — MCP aggregator providing tools (see `docs/mcp-servers.md`)
- `src/core/skills/` + `src/capabilities/<name>/skills/` — Skills (app + capability-owned)
- `src/shared/llm/providers/` — Provider adapters with log hook and audit logging
- `src/shared/typesafe/` — TypeSafe Classifier (Jev) client
- `src/chat/extract/` — Deterministic parameter extraction
- `src/workspace/session/` — Session and message persistence (SSE via `addMessage`)
- `src/workspace/logs/` — Log storage, formatter, and helpers
