# The `.wfp` top-level nodes

The document has two halves: the **work product** (content) and the **record**
(control/evidence). New nodes are marked **(new)**.

## Content plane — the work product

| Node | What it holds |
|---|---|
| `metadata` | Identity and fiscal framing: workspace name, entity, period, format version, and (new) `engagement_id` / `team_id` references into the Identity shell |
| `workflows[]` | The procedures — close, reconciliation, review — as repeatable steps |
| `tools[]` | Tool definitions the workflows reference |
| `data{}` | The books and working papers — named data entries |
| `knowledge[]` | Reference packs the workflows and chat consult |
| `rules[]` | User-authored rules and guardrails |
| `sessions[]` | The record of chat and automation runs |
| `plan[]`, `todos[]`, `saved_prompts[]` | Working state: plans, task lists, saved prompts |

## Record plane — the system-of-record layer

| Node | What it holds |
|---|---|
| `privacy_mask` **(new)** | The confidentiality map (real → stand-in), promoted from a hidden knowledge-pack hack to a first-class, owned, auditable node with per-entry provenance |
| `provenance` **(new)** | The append-only change ledger — the "Time Machine". Every mutation is an event; checkpoints are `kind: "checkpoint"` events (named markers, not separate snapshots) |
| `logs[]` | Evidence of LLM calls (already captured inside the file) |

## The `provenance` event

```ts
interface ProvenanceEvent {
  id: string;
  prevHash: string | null;        // hash of the previous event — the tamper-evidence chain
  kind: "change" | "checkpoint";
  action: "upsert" | "delete";
  target: string;                 // e.g. "data:ap", "workflow:<id>", "metadata"
  newContentHash: string | null;  // content hash of the node's new value (change only)
  actor: string;                  // user id or synthetic agent id
  producer?: string;              // capability/app id, e.g. "budget-app"
  producerVersion?: string;       // e.g. "2.3"
  eventAt: string;                // event time — the ordering key
  period?: string;                // business-period tag when relevant
  label?: string;                 // checkpoint label, e.g. "October close — final"
  rationale?: string;             // lazily-derived "why"
}
```

## The `privacy_mask` node

```ts
interface PrivacyMask {
  entries: Array<{
    real: string;
    fake: string;
    source: "manual" | "automatic";
    addedAt: string;
    addedBy?: string;
  }>;
}
```

## Storage notes

- `provenance` and `privacy_mask` are each their own section, stored as their
  own encrypted column (`enc_provenance`, `enc_privacy_mask`) in the `workspaces`
  table — the same pattern `sessions` and `logs` use.
- Historical node values live in a content-addressed `workspace_content` table
  (keyed by the event's `newContentHash`), encrypted with the workspace secret,
  so the Time Machine can reconstruct "old → new" for diffs. Large `data`
  payloads are not stored.
- The `provenance` ledger grows unboundedly for now (no archival roll-up).
- On export, the user can exclude `provenance` (the "Time Machine" history)
  alongside `logs` and `sessions` via the existing `?strip=` mechanism.
- `privacy_mask` always travels with the file (it is needed to decode the mask)
  and is never excluded on export.
