import { describe, expect, test } from "bun:test";
import { WorkspaceSession } from "./WorkspaceSession";
import { hashValue } from "./hash";

function makeSession(): WorkspaceSession {
  return new WorkspaceSession({
    userId: "user-1",
    workspaceId: "ws-1",
    wfp: {
      metadata: { format_version: "1.0.0", workspace: "Test" },
      workflows: [],
      tools: [],
      data: {},
      knowledge: [],
      sessions: [],
      provenance: [],
      privacy_mask: { entries: [] },
    },
    secret: null,
  });
}

describe("provenance recording", () => {
  test("records a hash-chained change event on every mutation", () => {
    const s = makeSession();
    s.upsertWorkflow({ id: "w1", name: "Close", nodes: [] });
    s.setDataEntry("ap", { content: "col1,col2\na,b", content_type: "csv" });
    s.recordCheckpoint({ label: "October close" });

    const events = s.getProvenance();
    expect(events.length).toBe(3);

    // Chain integrity: each event's prevHash equals the hash of its predecessor.
    expect(events[0].prevHash).toBeNull();
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(hashValue(events[i - 1]));
    }

    // Change events carry target/action/content hash.
    expect(events[0].target).toBe("workflow:w1");
    expect(events[0].action).toBe("upsert");
    expect(events[0].kind).toBe("change");
    expect(events[0].newContentHash).toBe(hashValue({ id: "w1", name: "Close", nodes: [] }));

    expect(events[1].target).toBe("data:ap");
    expect(events[1].action).toBe("upsert");

    // Checkpoint markers are distinct events with no content hash.
    expect(events[2].kind).toBe("checkpoint");
    expect(events[2].label).toBe("October close");
    expect(events[2].newContentHash).toBeNull();
  });

  test("delete records action delete with a null content hash", () => {
    const s = makeSession();
    s.upsertWorkflow({ id: "w1", name: "Close", nodes: [] });
    s.deleteWorkflow("w1");

    const events = s.getProvenance();
    const last = events[events.length - 1];
    expect(last.action).toBe("delete");
    expect(last.target).toBe("workflow:w1");
    expect(last.newContentHash).toBeNull();
  });

  test("stamps the actor and producer", () => {
    const s = makeSession();
    s.setPlan([]);
    const last = s.getProvenance()[s.getProvenance().length - 1];
    expect(last.actor).toBe("user-1");
    expect(last.producer).toBe("workflowpeople");
    expect(typeof last.producerVersion).toBe("string");
    expect(last.eventAt).toBeTruthy();
  });

  test("buffers content-addressed payloads for small nodes, not data", () => {
    const s = makeSession();
    s.upsertWorkflow({ id: "w1", name: "Close", nodes: [] });
    s.setDataEntry("ap", { content: "a,b", content_type: "csv" });

    const pending = s.drainPendingContent();
    expect(pending.length).toBe(1);
    expect(pending[0].hash).toBe(hashValue({ id: "w1", name: "Close", nodes: [] }));
    // Draining clears the buffer.
    expect(s.drainPendingContent().length).toBe(0);
  });

  test("recordSnapshot captures a data snapshot hash and buffers the data", () => {
    const s = makeSession();
    s.setDataEntry("ap", { content: "a,b", content_type: "csv" });
    s.recordSnapshot({ label: "Oct close" });

    const events = s.getProvenance();
    const last = events[events.length - 1];
    expect(last.kind).toBe("checkpoint");
    expect(last.label).toBe("Oct close");
    expect(last.snapshotHash).toBe(hashValue({ ap: { content: "a,b", content_type: "csv" } }));

    const pending = s.drainPendingContent();
    expect(pending.length).toBe(1);
    expect(pending[0].hash).toBe(last.snapshotHash!);
  });
});
