import { describe, expect, test } from "bun:test";
import { reconstructState, reconstructWfp } from "./reconstruct";
import type { ProvenanceEvent } from "wfp-format";

function ev(partial: Partial<ProvenanceEvent>): ProvenanceEvent {
  return {
    id: "id",
    prevHash: null,
    kind: "change",
    action: "upsert",
    target: "metadata",
    newContentHash: null,
    actor: "u",
    eventAt: new Date().toISOString(),
    ...partial,
  } as ProvenanceEvent;
}

describe("reconstructState", () => {
  test("replays change events to a checkpoint, latest value wins", () => {
    const events = [
      ev({ id: "a", target: "workflow:w1", action: "upsert", newContentHash: "h1" }),
      ev({ id: "b", target: "data:ap", action: "upsert", newContentHash: "h2" }),
      ev({ id: "cp1", kind: "checkpoint", target: "checkpoint" }),
      ev({ id: "c", target: "workflow:w1", action: "upsert", newContentHash: "h3" }),
      ev({ id: "d", target: "data:ap", action: "delete", newContentHash: null }),
    ];

    const atCp1 = reconstructState(events, "cp1");
    expect(atCp1.get("workflow:w1")).toEqual({ hash: "h1", deleted: false });
    expect(atCp1.get("data:ap")).toEqual({ hash: "h2", deleted: false });

    const atEnd = reconstructState(events, null);
    expect(atEnd.get("workflow:w1")).toEqual({ hash: "h3", deleted: false });
    expect(atEnd.get("data:ap")).toEqual({ hash: null, deleted: true });
  });

  test("re-creating a deleted node clears the deleted flag", () => {
    const events = [
      ev({ id: "a", target: "rule:r", action: "delete", newContentHash: null }),
      ev({ id: "b", target: "rule:r", action: "upsert", newContentHash: "h" }),
    ];
    const state = reconstructState(events, null);
    expect(state.get("rule:r")).toEqual({ hash: "h", deleted: false });
  });
});

describe("reconstructWfp", () => {
  test("assembles sections from node values and the data snapshot", async () => {
    const state = new Map([
      ["metadata", { hash: "mh", deleted: false }],
      ["workflow:w1", { hash: "wh", deleted: false }],
      ["rule:r1", { hash: "rh", deleted: false }],
      ["data:ap", { hash: "dh", deleted: false }],
    ]);
    const store = new Map<string, string>([
      ["mh", JSON.stringify({ format_version: "1.0.0", workspace: "Acme" })],
      ["wh", JSON.stringify({ id: "w1", name: "Close", nodes: [] })],
      ["rh", JSON.stringify({ name: "r1" })],
      ["dh", JSON.stringify({ ap: { content: "a,b" } })],
    ]);
    const load = async (h: string) => store.get(h) ?? null;

    const wfp = await reconstructWfp(state, load, "dh");
    expect(wfp.metadata.workspace).toBe("Acme");
    expect(wfp.workflows?.length).toBe(1);
    expect(wfp.rules?.length).toBe(1);
    expect(wfp.data).toEqual({ ap: { content: "a,b" } });
  });
});
