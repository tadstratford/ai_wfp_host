// Provenance — the append-only "Time Machine" ledger (top-level `provenance`
// node). Every mutation to the .wfp appends one event, forming a hash-chained,
// tamper-evident history. Checkpoints are just `kind: "checkpoint"` events
// (named markers over the ledger), not separate snapshots.

export type ProvenanceKind = "change" | "checkpoint";

export type ProvenanceAction = "upsert" | "delete";

export interface ProvenanceEvent {
  /** Unique event id. */
  id: string;
  /** Hash of the previous event — the tamper-evidence chain (null at genesis). */
  prevHash: string | null;
  /** "change" (a node mutation) or "checkpoint" (a named marker over the ledger). */
  kind: ProvenanceKind;
  /** "upsert" covers add + alter; "delete" removes a node. */
  action: ProvenanceAction;
  /** What changed, e.g. "data:ap", "workflow:<id>", "metadata". */
  target: string;
  /** Content hash of the node's new value (change events only). */
  newContentHash: string | null;
  /** Who performed the change — a user id or a synthetic agent id. */
  actor: string;
  /** Producer (capability/app) id, e.g. "budget-app". */
  producer?: string;
  /** Producer version, e.g. "2.3". */
  producerVersion?: string;
  /** Event time — the ordering key of the ledger. */
  eventAt: string;
  /** Business-period tag when relevant (e.g. "2026-10"). */
  period?: string;
  /** Checkpoint label, e.g. "October close — final". */
  label?: string;
  /** Human-readable "why" — derived lazily from the ledger + session messages. */
  rationale?: string;
  /** Content hash of a full-data snapshot captured at a period close (for
   *  point-in-time reconstruction of the books). Checkpoints only. */
  snapshotHash?: string;
}
