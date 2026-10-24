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

