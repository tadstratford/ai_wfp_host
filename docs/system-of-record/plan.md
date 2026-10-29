# System of Record — Plan

Five sections, ordered by dependency. Each feature follows the repo's
"adding-a-feature" checklist (types → session accessors → store → routes → UI →
chat/MCP sync).

## 1. Data (the core)

Status: **done**.

- [x] Types: `ProvenanceEvent` (`src/types/provenance.ts`), `PrivacyMask` /
      `PrivacyMaskEntry` (`src/types/privacy.ts`).
- [x] Extend `WfpFile` with `provenance` + `privacy_mask`; `Metadata` with
      `engagement_id` / `team_id`.
- [x] `WorkspaceSession` accessors (`getProvenance` / `appendProvenanceEvent`,
      `getPrivacyMask` / `setPrivacyMask`) + `provenance` / `privacy_mask` in
      `WfpSectionName`.
- [x] Store columns `enc_provenance` / `enc_privacy_mask` (`workspaceStore.ts`)
      + schema (`schema/supabase-schema.sql`).
- [x] Promote privacy to `privacy_mask` — rewired `knowledge/privacy.ts` to read
      the node (legacy `privacy-map` pack fallback + migration on write).
- [x] Export: exclude `provenance` alongside `logs` / `sessions`.

Open: ledger grows unboundedly (accepted for now); no archival roll-up.

## 2. Harness (auto-stamping)

Status: **in progress**.

- [x] Centralized capture in `WorkspaceSession`: plaintext hash + append
      `ProvenanceEvent` on every mutation (single chokepoint `#recordChange`).
- [x] Hash-chain utilities (`src/workspace/hash.ts`) + producer/version registry
      (`src/workspace/producer.ts`).
- [x] `kind: "checkpoint"` events at **close** (lifecycle) and **milestone**
      (workflow run completes, `session_all.ts`). No timer — the secret is only
      in RAM during a session.
- [x] Content-addressed payload store (`workspace_content` table +
      `contentStore.ts`) — buffers small node versions on mutation and drains
      them to the store on auto-save, so historical values can be reconstructed.
      `data` payloads are excluded (too large).
- [ ] Checkpoint on **open** (deferred — noisy; the prior close checkpoint
      covers it for single-user workspaces).
- [ ] Wire producer context into runs (currently the host default; capabilities
      will `setProducerContext` around a run).
- [ ] LLM-generated `rationale` (currently deterministic from the ledger).

## 3. UI (Time Machine)

Status: **in progress** — see [`ui.md`](ui.md).

- [x] Time Machine timeline page (`/app/timemachine`) — read-only ledger
      browser: checkpoint landmarks + change rows with producer/version and
      content-hash fingerprint.
- [x] Per-event diff (click a change row → old→new, via the content-addressed
      store) and deterministic checkpoint rationale (a "what changed" summary).
- [x] Checkpoint view (`/app/timemachine/checkpoint/:id`) — reconstructs the
      state at a checkpoint and diffs it against "now" ("compare with now"),
      replaying the ledger via `reconstruct.ts`.
- [x] Point-in-time snapshot ("Snapshot now" + `WorkspaceSession.recordSnapshot`)
      — a period-close-style checkpoint that captures the full `data` section,
      plus "Download this snapshot as a .wfp" (reconstructs the whole document).
- [x] UX polish — expand/collapse toggle (`<details>`), removed the decorative
      icon, filtered session/log churn behind a "show all" toggle, and wired a
      real "why" (the workflow's concluding message) into workflow checkpoints.
- [ ] LLM-generated `rationale` for arbitrary checkpoints (currently the
      workflow-completed checkpoint carries the narration; others fall back to
      the deterministic summary).
- [ ] Firm control tower + client read-only view (after Identity & Access).

## 4. Capabilities

Status: **later**.

- [ ] Each capability under `src/capabilities/` declares a `producer id +
      version` so the harness can stamp its output. No behavioral change.

## 5. Identity & Access

Status: **later** — define only, no enforcement this phase.

- [ ] `teams` / `engagements` shell schema (id, name, membership, dept rate;
      client, scope, period, staffing).
- [ ] `metadata.engagement_id` / `team_id` reference them; provenance stamps
      carry denormalized labels so the `.wfp` stays self-describing.
- [ ] Deferred: RBAC, team-based grants, segregation-of-duties blocking.

## 6. Diary (the activity story)

Status: **done** — see [`diary.md`](diary.md).

- [x] Types (`src/types/diary.ts`), `diary` node on `WfpFile`, `enc_diary` column
      + schema.
- [x] Compaction (`src/workspace/diary/compaction.ts`): 60 entries → summary,
      20 summaries → narrative chunk, deterministic + `batchHash`.
- [x] Capture hooks: session completion (chat + workflow), data load, rule
      add/update/delete — via `WorkspaceSession.recordDiaryEntry`.
- [x] LLM (`src/workspace/diary/summarize.ts`): session description
      (fire-and-forget) + lazy highlight generation, privacy-masked.
- [x] MCP `app-diary` server (`diary_narrative`, `diary_summaries`, `diary_search`)
      + registration + context wiring.
- [x] Diary UI (`/app/diary`) — narrative → summaries → entries drill-down, with
      lazy LLM highlight fill on view.

## 7. Generic deterministic data tools (LLM-orchestrated)

Status: **in progress** — see [`../data-quality-pipeline.md`](../data-quality-pipeline.md).

Goal: a small set of generic, deterministic data tools the chat LLM *selects* —
given the user message, the workspace rules, and the data schema — instead of a
load-time pipeline that precomputes findings with inference heuristics. The LLM
picks the tool and the exact columns; the tool does the arithmetic. This replaces
the earlier "precompute everything at load" design (which produced wrong
authoritative numbers via column-inference — see the `test data and rules.wfp`
review).

- [x] Deterministic engines (pure, no LLM): `src/data/profile.ts` (`profileTable`,
      `parseAmount`, `checkFooting`, `detectFootings`), `src/data/split.ts`
      (`splitAmount`), `src/data/ruleApply.ts` (`evaluateRuleSpec`), plus the existing
      `src/data/reconcileRelationship.ts` / `reconcile.ts` / `filter.ts` / `stats.ts`.
- [x] Tools registered in the `data` capability: `profile_data` (per-column
      completeness/duplicates + explicit footings), `classify_data` (multi-outcome
      bucketing), `split_data` (cross-table percentage allocation). Footings are
      explicit — the LLM names the columns; nothing is auto-inferred.
- [x] Removed the precompute pipeline: `reconcileAll.ts`, `ruleResolve.ts`,
      `data_catalog.profiles`/`reconciles`, the `rule_application` node, and
      `Rule.spec` — rules are context only, not pre-evaluated.
- [x] Chat wiring (vers_8 / vers_9) — soft constraint: added `profile_data` /
      `classify_data` / `split_data` / `reconcile_relationship` / `list_relationships`
      to both orchestrators' `ALWAYS_AVAILABLE` (and vers_8 `COMPOSABLE_PRIMITIVES`),
      added them to vers_9 `VERIFIABLE_TOOLS`, and added prompt guidance to prefer the
      deterministic tools over in-prose arithmetic. Escalate to a hard constraint /
      vers_11 only if the model still computes by hand.
- [x] Golden-fixture validation: `src/data/golden/cp3.ts` (real CP3 data + `GOLDEN`
      constants) + `src/data/golden/cp3.test.ts` lock the engines to the
      hand-verified figures (`156,437.41` footing, Ironwave `−3,204.01` variance,
      EBITDA buckets, commitment split). Caught + fixed a `matchesClause` null-vs-
      numeric bug (`src/data/filter.ts`).
- [ ] (Optional) Reporting/dashboard consume the profile tool for data-health views.

## 8. Storytelling data-review (chat v10)

Status: **in progress** — see [`../data-storytelling.md`](../data-storytelling.md).

Goal: frame working with financial data as a **story** ("accounting is
communication") to lower cognitive burden. Break the chat orchestration into
understandable buckets (sets), keep the reader involved by announcing each step,
and make every visual element addressable (a model/human can point at it and
click it for detail).

- [x] **Setup/status visuals** (foundation, done in vers_9): relationship map,
      variance strip, verdict cards — `vers_9` `buildReview` +
      `InlineReview.tsx`. Node/edge tooltips + click→anchor to table details.
- [x] **Persona as a rule** — a single `default_persona` rule in `wfp.rules[]`
      (user-manageable); the persona bucket reads it and announces
      "Reading as: …" (falls back to a generic reviewer when the rule is absent).
      `vers_10` reads it via `WorkspaceSession.getRules()`.
- [x] **Read-only MVP buckets** — `persona → setup → status → gap` as a new
      `vers_10` (reusing vers_9's `runComposedPlan`/`tryComposeReviewPlan` and
      delegating resume states to vers_9). Non-review requests delegate to vers_9.
- [x] **Display-element registry + structured refs** — stable element ids
      (`node-N`/`edge-N`/`var-N`/`verdict-N`) in the review payload, and
      `refs: [...]` on each story message's `json`. The payload doubles as the
      registry (no separate store yet).
- [x] **Click → detail** — `POST /sessions/api/review-detail` appends an
      element's detail to the end of the session; HTML elements (table rows,
      verdict cards, variance rows, gap items) `hx-post` to it.
- [x] **Plan → execute → resolution (report-only)** — step 5 `plan` is
      LLM-composed (`buildRemediationPlan` in `vers_10/plan.ts`, deterministic
      fallback) and Jev-verified (`verifyPlan`); step 6/7 render a self-contained
      error report (`vers_10/resolution.ts` + `reportRenderer`) behind the
      write-approval gate (`pendingExecute`). A live `story-progress`/`story-stage`
      7-step checklist keeps the reader oriented.
- [ ] **Journal posting (resolution, deferred)** — wire `qbo_journal_create` /
      `qbo_gl_review` / GL schema into the resolution (adjusting entry, GL
      journal) behind the write-approval gate; the report-only path is the
      current boundary.

## 9. Rule-aware orchestrator (chat v11)

Status: **in progress**.

Build contract / harness invariants live in **`src/chat/vers_11/README.md`** — the
stable-harness rules (no data/message-type branching, tools-only, self-contained,
minimal regex, three computation tiers, session-context cleaning, config surface,
feedback-updated plan).

Goal: one plan-first orchestrator (`ORCHESTRATOR=vers_11`) that turns every
request into a materialized, maintained `TurnPlan` of typed steps — `data` (a
tool + args), `communication` (an `addMessage`), `control` (approval / clarify).
Workspace rules are always-on policy: selected by name + short description (a Jev
funnel), auto-classified into an enforcement tier, and enforced as data steps
placed **before** the write-approval gate — a flagged rule blocks the write.

- [x] **Typed plan model** — `vers_11/types.ts` (`Step` union + `TurnPlan` with a
      `cursor` anchor). Steps carry tool names + args + status only; evidence
      lives in the workspace, not the plan.
- [x] **Rule selection funnel** — `vers_11/select.ts`: two Jev calls (tag choice →
      name→description choice), env-tunable thresholds (`RULE_TAG_THRESHOLD`,
      `RULE_PROB_THRESHOLD`, `RULE_MAX_RULES`, `RULE_MAX_TAGS`, `RULE_MAX_CANDIDATES`).
      Bounds a "hundreds of rules" client to a small candidate set.
- [x] **Tier classification** — `vers_11/classifyRule.ts`: pure keyword→tier map
      (reconcile/split/aggregate → `deterministic`; membership → `check_data`
      (`classified`); else `audit`).
- [x] **LLM-composed rule checks** — `vers_11/composeRuleChecks.ts` derives the
      check tool args from rule text + data inventory, fail-closed (a rule that
      can't be validated downgrades to `audit`/"not proven").
- [x] **Compose + execute + resume** — `vers_11/composePlan.ts` (planner cascade→llm
      data steps + rule checks + approval gate), `vers_11/executePlan.ts` (typed
      executor + pass/flag interpreter; `approval` **blocked** on a flagged rule),
      `vers_11/resume.ts` (resolve a paused control step).
- [x] **Right-panel plan + review report** — `vers_11/executePlan.ts` emits the
      `plan` checklist (`kind: "plan"` + `step-status` live updates) and, for a
      review-shaped turn, renders the deterministic review card by reusing v9's
      `buildReview`/`renderReviewReport` (exported).
- [x] **Registration** — `vers_11` added to the `ORCHESTRATOR` selector
      (`src/chat/index.ts`) and env knobs documented in `.env.example`.
- [x] **Communication as a skill** — `story-data-review` (`src/core/skills/`) with
      `## Tools needed: show_message`; its beats become `communication` steps, not
      hardcoded arrays (replaces `vers_10`'s `STORY_STAGES`).
- [x] **Present results** — a read-only turn whose final data step is a
      presentable tool relays the tool's result to the user as markdown,
      closing the "list the data" silent-drop gap. The tool opts in via a
      `present` flag on `CapabilityTool` (`isPresentableTool` in
      `capabilities/registry.ts`); the executor (`vers_11/executePlan.ts`)
      relays it. `list_data` returns markdown and is relayed verbatim;
      `get_data` returns structured JSON (kept JSON for the LLM/workflow
      consumers), which the executor formats via `renderGetDataResult`.
- [x] **Structured rule tool references** — `Rule`/`Skill` gain `tools?: {name, role}[]`
      (JSON, no regex). Skills declare `tools:` in frontmatter; rules declare it via
      `create_rule`/`update_rule` and the rule builder. `vers_11` reads `rule.tools`
      directly (legacy `## Tools needed` is derived once at read time). Validated on
      workspace open (`src/rules/validate.ts`) and surfaced as a Rules-panel badge.
- [ ] **Jev result verification** — reuse `vers_9/verify.ts` (`verifyResult` /
      `verifyPlan`) as a post-plan gate; the deterministic review + rule-report are
      currently the trust artifact.
- [ ] **Full story beats** — wire the `story-data-review` markdown into per-beat
      `show_message` emission (the beats are authored as a skill but not yet emitted
      as a live narrative checklist).
- [ ] **Prompt narrowing** — inject the *selected* rule subset (not all workspace
      rules) into `buildSystemPrompt` for large rule sets.

