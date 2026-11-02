# vers_11 — Design

> The single chat orchestrator. This document describes **what vers_11 is** in full,
> then checks that design against the requirements. It assumes vers_6/8/9/10 are
> gone — the only orchestrator is `src/chat/vers_11/`. Any residual constraint left
> by a removed version is flagged in §9 with the action to resolve it.

---

## 1. What we are building

One plan-first, rule-aware chat orchestrator. Every user turn becomes a materialized
**`TurnPlan`** — an ordered list of typed steps — which is composed, executed, and
**maintained across turns** (revised by new feedback, never discarded).

The harness is deliberately small and generic. Everything request-specific lives in
**skills** (knowledge) and **tools** (execution). The harness does not know what a
"report", a "reconciliation", or a "story" is.

### 1.1 The plan is the single object

```
TurnPlan {
  id: string
  steps: Step[]            // ordered
  cursor: number           // index of the next step to run
  provenance: { skills: string[], rules: SelectedRule[] }
  createdAt: string
}

Step =
  | { kind: "data",          tool, args, label, durable?, ruleCheck?, tier?, status }
  | { kind: "communication", message, stage?, status }        // an addMessage
  | { kind: "control",       control: "approval" | "clarify", prompt?, missing?, status }
```

- `data` steps carry **tool name + args + status** — never the data itself.
- Evidence (tool output) lives in the workspace (`session.parameters`, `metadata`),
  not in the plan.
- `control` steps are the "maintain" anchor: execution **pauses** there, persists the
  cursor, and returns control to the user.

### 1.2 Step statuses

`pending → running → done | flag | error | satisfied | blocked`

- `flag` — a rule-check data step whose output failed (blocks the write gate).
- `blocked` — an approval gate that refused to proceed because a prior rule check flagged.
- `satisfied` — a control step the user resolved (approve / answered the clarify).

---

## 2. The loop

```
message ──► ingest ──► resume? ──► understand ──► compose ──► execute ──► verify ──► persist
                            │            (skills)     (tools)     (data)    (LLM)      │
                            └────────────────────── update the plan ◄────────────────┘
                                    (message / data / feedback buttons)
```

### 2.1 Ingest

- Load the session, de-dupe the incoming message, set workspace/tool scopes, register
  the LLM log hook (so every Jev/LLM call surfaces as a collapsible "call · view log").

### 2.2 Resume

- If `metadata.plan` is paused at a `control` step, this message is a **continuation**:
  resolve the gate (`resume.ts`) and keep executing. A `cancel`/`no` discards the plan.
- Otherwise the message is either a fresh request or a **follow-up**; in both cases the
  plan is **revised**, not thrown away (§5).

### 2.3 Understand — skills

- **Route** — one Jev call selects the active skills plus a few signals
  (`needs_tool`, `mutating`, `complexity`, `follow_up`). Skills carry knowledge; the
  harness only records which skills are active.

### 2.4 Rules (always-on policy)

- **Select** — a two-stage Jev funnel (tag vocabulary → rule choice) picks the workspace
  rules that apply, bounded so hundreds of rules stay cheap.
- **Classify** — each selected rule is assigned an enforcement tier:
  - `deterministic` — enforced by a deterministic tool (`reconcile_relationship`,
    `aggregate_data`, `split_data`, `profile_data`).
  - `classified` — enforced by `check_data` (a Jev yes/no over the table).
  - `audit` — not mechanically provable; reported as "not proven".
- Rules become `data` steps placed **before** the write-approval gate; a flagged rule
  blocks the write.

### 2.5 Compose — tools

`composePlan` assembles the `TurnPlan`:

1. **Planner** emits the operational `data` steps (see §4.6).
2. **Rule checks** are inserted before the first mutating/durable step.
3. **Approval gate** (`control`) is placed at the write boundary when the turn mutates.
4. **Disclosures** for downgraded/audit rules (`communication` steps).
5. **Delivery tail** — if the plan doesn't already produce output, a presentation step
   is appended so the turn always delivers something visible (§4.8).

### 2.6 Execute — data

`executePlan` walks the plan:

- `data` → resolve `{{result}}`/templates → call the tool via the MCP aggregator →
  record output into `session.parameters.result` → emit `step-status` → interpret any
  rule-check flag.
- `communication` → `addMessage`.
- `control` → persist the cursor and **return** (turn ends, awaiting the user).

### 2.7 Verify — LLM

After execution, the turn's reply is checked against the deterministic evidence (§4.9).
A failed verification persists `pendingVerify` for the next message to address.

### 2.8 Persist

Write the minimal bag: `plan` (cursor + statuses), `parameters`, `toolCalls` (for
save-as-workflow), `evidence`, `lastRequest`, `lastActiveSkills`, any `pending*` gate.

---

## 3. The three computation tiers

Every decision in a turn is one of exactly three tiers. The tier is **declared**, and
where both engines are viable the choice is **config** (§7).

| Tier | Engine | Role |
|---|---|---|
| **Deterministic** | none (a pure tool) | Run a tool with no inference. The trust anchor — locked by golden fixtures. |
| **Near-Deterministic** | **Jev** | A structured decision (`noul` / `choice` / `score`). Classify, gate, select. Never generates prose. |
| **Probabilistic** | **LLM** | Decide, analyse, or **generate** — fill the JSON needed to run a tool, author prose/story, verify results. |

Rule of thumb: **selection/classification → Jev; generation → LLM; computation → tool.**

---

## 4. Stage-by-stage design and engine

This is the detailed answer to "what stages are actually configurable between LLM and Jev".

| # | Stage | Engine today | Configurable LLM⇄Jev? | Notes |
|---|---|---|---|---|
| 4.1 | Ingest / scopes / log hook | none | — | harness plumbing, no inference |
| 4.2 | Resume a paused gate | none | — | deterministic (`resume.ts`) |
| 4.3 | **Skill routing** | Jev | **yes** | a structured `choice`/`noul`; Jev is the default, an LLM `choice` is a drop-in. |
| 4.4 | **Rule selection (tags → rules)** | Jev | **yes** | same: pure selection over criteria. |
| 4.5 | **Rule tier classification** | regex keyword map | **yes (must become Jev/LLM)** | current regex is a stopgap; target Jev over rule tags/description. |
| 4.6 | **Plan composition** | cascade (Jev shape + deterministic template + LLM arg-fill), fallback `llm` planner | **yes** | already switchable via planner id (`cascade` ⇄ `llm` ⇄ `jev-step`); this is the main determinism knob. |
| 4.7 | Rule-check composition (rule → tool args) | LLM | **no** | generates structured JSON to run tools — generation is inherently LLM. |
| 4.8 | Delivery tail / present results | none (deterministic) | **no** | just appends/relays a tool's output; no decision. |
| 4.9 | **Result verification** | LLM | **yes** | LLM reasoning is the default; a Jev `noul` gate (`satisfies/complete/accurate`) is the cheaper alternative. This is the canonical LLM⇄Jev stage. |
| 4.10 | Rule-check interpretation (flag/block) | none (parse + threshold) | **no** | deterministic over the tool's JSON output. |
| 4.11 | Argument extraction | deterministic + LLM fill | partial | literals are deterministic; structured args that can't be synthesized fall back to LLM. |
| 4.12 | Terminal prose / story / summary | LLM (when present) | **no** | any free text is LLM by definition. |

**Configurable-between-LLM-and-Jev stages: 4.3, 4.4, 4.5, 4.6, 4.9.** Everything else is
either deterministic (no engine) or LLM-only (generation). These five are where the
user's "more or less LLM vs Jev" preference is honored.

---

## 5. Session context lifecycle

The harness owns context cleaning across messages. The `TurnPlan` **is** the context.

- **Resume or revise, never discard.** A new message at a `control` step resumes; a
  follow-up revises the remaining steps (append/replace) while keeping `evidence`,
  `lastRequest`, `activeSkills`. There is no "re-compose from scratch every turn".
- **Prune** completed steps from the working set; drop stale plans past their turn.
- **Cap** retained history (messages, evidence, tool calls) to a configurable bound.
- **Persist only** `plan` (cursor + statuses), `parameters`, `lastRequest`,
  `lastActiveSkills`, `evidence`, and any `pending*` gate.

New feedback is absorbed by **updating the plan**:

| Feedback | How it updates the plan |
|---|---|
| message (approve/cancel) | resolves a `control` step |
| message (answer to clarify) | stores typed params, re-composes with them |
| message (new/corrected intent) | revises the remaining steps |
| data (rule check flags) | marks the step `flag`, blocks the write gate |
| data (empty/unexpected result) | revises the tail (re-plan) |
| feedback button `satisfied` | persists the turn done |
| feedback button `not_satisfied` | re-enters the loop with the gap, re-composes |

---

## 6. Requirements check

The design is checked against the requirements below. A requirement is **met**, **open**,
or **constrained by a removed version** (flagged in §9).

| Requirement | Status | Where |
|---|---|---|
| Harness never changes for a new data/message type | met | §1, §4 — stages are type-agnostic |
| Tools are the only executable unit | met | `data` steps call conforming tools via the aggregator |
| Missing tool/skill fails closed, no harness change | met | tool absence = not offered / clear error |
| Everything vers_11 needs lives in vers_11 | open | §8, §9 (planner + skillRouter still external) |
| Minimal regex | open | `classifyRule.ts`, follow-up/references-prior matchers (§9) |
| Session context cleaning across messages | open | §5 (resume-or-revise + pruning not yet built) |
| Changes are configuration (loops, LLM vs Jev) | open | §7 (knobs not yet hoisted) |
| User can tune LLM vs Jev | open | §4 table defines the five switchable stages |
| Storytelling handled by skills + tools, not harness | open | beats = `communication` steps from a skill (`show_message`) |
| Result verification (LLM) | open | §4.9, §9 |

---

## 7. Configuration surface

Everything tunable is a knob, not an `if` in harness code.

| Knob | Stage | Range |
|---|---|---|
| model | global | user-selected LLM provider/model |
| `CHAT_PLANNER` | 4.6 | `cascade` ⇄ `llm` ⇄ `jev-step` |
| engine mix | 4.3, 4.4, 4.5, 4.9 | `jev` ⇄ `llm` per stage |
| max steps / replans | loop | integer bounds |
| rule thresholds | 4.4, 4.5 | `RULE_TAG_THRESHOLD`, `RULE_PROB_THRESHOLD`, `RULE_MAX_*` |
| verify gates | 4.9 | `satisfies`/`complete`/`accurate`/`thorough` cutoffs |
| context cap | 5 | retained history/evidence bound |

---

## 8. Directory (target — self-contained)

```
src/chat/vers_11/
  index.ts              ingest: session load, dedupe, banner, log hook, scopes
  orchestrator.ts       processUserMessage — the loop (resume → route → rules → compose → execute)
  config.ts             the server-global knob surface (loadConfig)
  types.ts              TurnPlan + Step union + SelectedRule/ClassifiedRule/RuleTier
  ruleParse.ts          parse a rule's ## Instructions / ## Tools needed / ## Rules
  composePlan.ts        assemble the TurnPlan (planner steps + rule checks + gate + delivery tail)
  executePlan.ts        walk the plan, run tools, interpret rule-check flags, present + verify results
  resume.ts             resolve a paused control step
  review.ts             deterministic review report + reconcile (buildReview/renderReviewReport/reconcileReviewEvidence)
  verify.ts             LLM result verification (satisfies/complete/accurate/thorough + issues)
  select.ts             rule-selection funnel (Jev)
  classifyRule.ts       rule tier classification (## Rules + capability-tool audit guard)
  composeRuleChecks.ts  LLM-composed rule→check steps
  skillRouter.ts        route() — skill selection (Jev)
  getSkillsPrompt.ts    system skill names for routing
  util.ts               withTimeout + isApproval
  plan/                 the planner layer (moved in from src/chat/plan/)
    planner.ts          getPlanner registry
    cascade.ts          shape registry + Jev plan-shape classification
    llm.ts              one-shot LLM planner (fallback)
    primitives.ts       composable tool roster
    outputs.ts          tool output contract
    types.ts            NodePlan / PlanStep
```

---

## 9. Constraints inherited from removed versions (flag + action)

These are the places vers_11 still touches code that belongs to a removed version.
Each is a concrete blocker to "self-contained" and has a specific resolution.

| # | Constraint | What it is | Action |
|---|---|---|---|
| 1 | `route` lives in `vers_8/skillRouter.ts` | skill selection is imported across versions | **done** — folded `skillRouter.ts` + `getSkillsPrompt.ts` into `vers_11/`. Remaining: **remove `src/chat/vers_8/`**. |
| 2 | `OrchestratorIO`, `isApproval`, `buildReview`, `renderReviewReport`, `reconcileReviewEvidence` live in `vers_9/orchestrator.ts` | the IO type, approval parser, and review-report renderer are imported from a version that will be deleted | **done** — `OrchestratorIO` → `types.ts`, `isApproval` → `util.ts`, review helpers → `review.ts`. Remaining: **remove `src/chat/vers_9/`**. |
| 3 | The planner layer lives in `src/chat/plan/` (shared, pre-version) | `planner`, `cascade`, `llm`, `primitives`, `outputs`, `clarify`, `types` are outside vers_11 | **done** — copied into `vers_11/plan/` (relative imports fixed). Remaining: **delete `src/chat/plan/`** once nothing else references it. |
| 4 | `src/chat/index.ts` is a version barrel (`ORCHESTRATOR` selects v8/v9/v10/v11) | the entry point dispatches across versions | collapse `index.ts` to export only vers_11's `handleMessage`; keep `ORCHESTRATOR` as a no-op alias if needed for migration. |
| 5 | `src/chat/README.md` documents four orchestrators | top-level chat README describes all versions | rewrite as vers_11-only (or fold into this doc). |
| 6 | Storytelling still references `vers_10` orchestration | `docs/data-storytelling.md` cites `vers_10/orchestrator.ts` | rewrite the doc to express beats as `communication` steps from a skill; **remove `src/chat/vers_10/`**. |
| 7 | `vers_5` (and any pre-version orchestrator) still present | dead orchestrator code — `src/chat/index.ts` only imports vers_8/9/10/11, so `vers_5` is unreferenced | **remove `src/chat/vers_5/`** (and any other `vers_*` except `vers_11`) once vers_11 is the only entry point. |

---

## 10. Build sequence (current → stable)

- [x] **Self-contain (code)** — folded `skillRouter` + `getSkillsPrompt` into
      `vers_11/`; extracted `OrchestratorIO`/`isApproval`/review helpers out of
      `vers_9`; copied the planner layer into `vers_11/plan/`.
- [ ] **Self-contain (entry point)** — collapse `src/chat/index.ts` to vers_11
      only; then remove `vers_5`/`vers_8`/`vers_9`/`vers_10` and `src/chat/plan/`.
- [x] **LLM verification** — `verify.ts` (LLM) + `shouldVerify` scope predicate +
      `verdictPasses` gates; wired into `executePlan` with `pendingVerify` persistence.
- [x] **Config surface** — `config.ts` holds every lever (temperature, engine mix,
      escalation ceiling, thresholds, loop bounds, budget, verify gates, context caps);
      skillRouter/select/executePlan/llm/cascade/composeRuleChecks read it.
- [x] **De-regex (classifyRule)** — `classifyRule` now classifies the `## Rules`
      section and guards capability-tool (method) rules to `audit` instead of a wrong
      data tool; `ruleParse.ts` splits instructions/tools/rules.
- [x] **Rules feed the planner** — `buildToolRoster` unions rules' `## Tools needed`;
      selected rules' markdown is injected as `PlanRequest.guidance`; a rule naming a
      disabled-capability tool surfaces an actionable error.
- [x] **Rule-check dedupe** — `composeRuleChecks` emits one "not proven" per rule.
- [x] **Compute ladder** — `resolveMethod` (tool → spec → judgment → gap) per
      instruction, config-gated by `escalation.ceiling`/`gapDefault`; a blocked gap
      surfaces as a fail-closed `clarify` step in `composePlan`.
- [ ] **Plan revision + context cleaning** — resume-or-revise instead of discard; prune
      completed steps; cap history.
- [ ] **Feedback buttons re-enter the loop** — `not_satisfied` → re-compose with the gap.
- [ ] **Delivery tail in `composePlan`** — `table_to_markdown → show_message` (read/show)
      or `report_table → chat_download` (report).
- [ ] **Storytelling via skills/tools** — beats as `communication` steps; remove any
      harness story logic.
- [ ] **Rule-builder tool validation** — `create_skill`/`update_skill` + rule wizard
      validate `## Tools needed` (tool exists + capability enabled) and warn.
- [ ] **Delete removed versions** — execute the §9 actions (remove vers_5/8/9/10).

---

## 11. Status

**In progress.** Shipped: typed plan model, rule funnel, rule parsing (instructions/
tools/rules), tier classification (## Rules + capability-tool audit guard), rule-check
composition (deduped), compose/execute/resume, present-results, right-panel plan +
review report, LLM verification, and the config surface. Open: compute ladder
(`resolveMethod`), plan revision + feedback buttons, delivery tail, storytelling,
rule-builder validation, and removal of other versions.

Related: `docs/architecture.md`, `docs/system-of-record/plan.md` §9,
`docs/data-storytelling.md`.
