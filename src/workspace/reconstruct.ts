// reconstruct — replay the provenance ledger to a point in time.
//
// The ledger is append-only; a node's value at any point is the latest change
// event targeting it up to that point. This walks the events once and returns
// a map of target → { hash, deleted } representing the workspace state at (and
// including all changes before) the given event id. `upToId: null` replays to
// the end.

import type { ProvenanceEvent, WfpFile } from "wfp-format";

export interface NodeState {
  /** Content hash of the node's value, or null when deleted/unknown. */
  hash: string | null;
  /** True when the node was deleted (and not re-created) as of this point. */
  deleted: boolean;
}

export function reconstructState(
  events: ProvenanceEvent[],
  upToId: string | null,
): Map<string, NodeState> {
  const state = new Map<string, NodeState>();
  for (const e of events) {
    if (e.id === upToId) break;
    if (e.kind !== "change") continue;
    if (e.action === "delete") {
      state.set(e.target, { hash: null, deleted: true });
    } else {
      state.set(e.target, { hash: e.newContentHash, deleted: false });
    }
  }
  return state;
}

/** Split a provenance target ("workflow:<id>") into its kind and name. */
export function splitTarget(target: string): [string, string] {
  const idx = target.indexOf(":");
  if (idx === -1) return [target, ""];
  return [target.slice(0, idx), target.slice(idx + 1)];
}

/** Assemble a full `.wfp` from a reconstructed state map: pull each node's value
 *  from the content store, group them back into sections, and attach the data
 *  snapshot (the books) when `dataSnapshotHash` is provided. Nodes whose content
 *  isn't stored (e.g. large data entries) are simply omitted. */
export async function reconstructWfp(
  state: Map<string, NodeState>,
  load: (hash: string) => Promise<string | null>,
  dataSnapshotHash: string | null,
): Promise<WfpFile> {
  const wfp: WfpFile = {
    metadata: { format_version: "1.0.0", workspace: "Restored" },
    workflows: [],
  };
  const workflows: unknown[] = [];
  const tools: unknown[] = [];
  const knowledge: unknown[] = [];
  const rules: unknown[] = [];
  const sessions: unknown[] = [];
  const logs: unknown[] = [];

  for (const [target, s] of state) {
    if (s.deleted || !s.hash) continue;
    const content = await load(s.hash);
    if (content === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      continue;
    }
    const [kind] = splitTarget(target);
    switch (kind) {
      case "metadata": wfp.metadata = value as WfpFile["metadata"]; break;
      case "workflow": workflows.push(value); break;
      case "tool": tools.push(value); break;
      case "knowledge": knowledge.push(value); break;
      case "rule": rules.push(value); break;
      case "session": sessions.push(value); break;
      case "log": logs.push(value); break;
      case "plan": wfp.plan = value as WfpFile["plan"]; break;
      case "todos": wfp.todos = value as WfpFile["todos"]; break;
      case "saved_prompts": wfp.saved_prompts = value as WfpFile["saved_prompts"]; break;
      case "data_catalog": wfp.data_catalog = value as WfpFile["data_catalog"]; break;
      case "privacy_mask": wfp.privacy_mask = value as WfpFile["privacy_mask"]; break;
      default: break;
    }
  }

  if (workflows.length) wfp.workflows = workflows as WfpFile["workflows"];
  if (tools.length) wfp.tools = tools as WfpFile["tools"];
  if (knowledge.length) wfp.knowledge = knowledge as WfpFile["knowledge"];
  if (rules.length) wfp.rules = rules as WfpFile["rules"];
  if (sessions.length) wfp.sessions = sessions as WfpFile["sessions"];
  if (logs.length) wfp.logs = logs as WfpFile["logs"];

  if (dataSnapshotHash) {
    const d = await load(dataSnapshotHash);
    if (d) {
      try {
        wfp.data = JSON.parse(d) as WfpFile["data"];
      } catch {
        /* snapshot unreadable — omit */
      }
    }
  }

  return wfp;
}
