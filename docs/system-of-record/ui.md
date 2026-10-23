# Time Machine — UI

All user-facing UI for the system-of-record features, documented together.
The user-facing name for history is **Time Machine** (the `provenance` ledger +
checkpoint markers); internally the node is still `provenance`.

## What exists today

- **Time Machine page** (`src/ui/pages/app/timemachine/timemachinePanel.tsx`,
  mounted at `/app/timemachine`) — a read-only timeline of the `provenance`
  ledger, most recent first. Checkpoints render as landmarks with a
  deterministic "what changed" summary; change events render as a compact
  "what changed, who/what produced it, when" row with the content-hash
  fingerprint.
- **Per-event diff** (`/app/timemachine/diff/:eventId`) — clicking a change row
  loads its old→new values from the content-addressed store
  (`workspace_content` table / `contentStore.ts`). Large `data` payloads aren't
  stored, so those show "historical content not available".
- **Checkpoint view** (`/app/timemachine/checkpoint/:id`) — clicking a checkpoint
  ("Compare with now") reconstructs the workspace state at that checkpoint and
  diffs it against the current state, showing "then → now" for every node that
  changed since. Replay lives in `reconstruct.ts`; current values come from
  `WorkspaceSession.getNodeValue`.
- **Snapshot now** — a button that records a point-in-time snapshot (a
  checkpoint that also captures the full `data` section). A snapshot's detail
  shows the captured entry count and a "Download this snapshot as a .wfp" link
  that reconstructs the entire document as-of that point (`reconstructWfp`).
- **Activity filter** — session and LLM-log changes are hidden by default
  (they're high-volume); "Show sessions & LLM logs" reveals them. Each item is
  an expandable `<details>` row, so diffs can be opened and collapsed.
- **Download modal** (`src/ui/pages/app/workspace/downloadModal.tsx`) — lets the
  user exclude `logs`, `sessions`, and now the `provenance` history
  ("Exclude history (Time Machine)") via the `?strip=` parameter handled in
  `src/ui/pages/app/workspace/api/handlers.tsx`.

## Planned screens

### 1. History browser — richer diffs

The timeline and old→new diff are built. A richer diff could render
domain-aware "change reports":

- **Numbers / balances** — old → new, with the delta called out.
- **Data rows** — transaction added / changed / removed, shown as rows.
- **Prose** — a word-level markdown diff.
- **Workflow/procedure** — "node added / reordered / config changed".

### 2. Checkpoint view

Lists `kind: "checkpoint"` events (named markers). Actions:

- **Reopen as of X** — reconstruct the file state at that ledger position
  (each node's value at its latest event ≤ X).
- **Compare X vs Y** — side-by-side diff between two checkpoints.
- **Rationale** — the "why" is derived lazily from the ledger + session
  messages and shown here, so no LLM call blocks a checkpoint.

### 3. Firm control tower (later)

Rolls up the whole portfolio: which clients are current, stale, unreconciled,
or failed-audit, per team. Depends on the Identity & Access shell (teams +
engagements) and the firm-layer aggregation.

### 4. Client read-only view (later)

A masked, clean, read-only slice of a client's own file with its history — a
trust product for sharing with the client.

## Principles

- Server-rendered HTMX fragments, following `src/ui/` conventions.
- Diffs are domain-aware (accounting "change reports"), never raw unified diffs.
- The Time Machine is read-only over the ledger — no editing history, no merge.
