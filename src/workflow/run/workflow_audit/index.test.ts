import { describe, it, expect } from "bun:test";
import { Tool_run } from "./index";

function mockApi(overrides: Record<string, unknown> = {}): any {
  const messages: any[] = [];
  const api: any = {
    getActiveWorkflow: () => ({ id: "wf1", name: "Test", description: "" }),
    getRules: () => [],
    getClassifierKey: async () => "test-key",
    getStream: () => "some output",
    addMessage: (m: any) => {
      messages.push(m);
    },
    ...overrides,
  };
  api._messages = messages;
  return api;
}

describe("workflow_audit node", () => {
  it("passes with no errors when no rules are declared", async () => {
    const api = mockApi();
    const res = await Tool_run(api);
    expect(res.status).toBe("success");
    const a = api._messages[0].json.workflowAudit;
    expect(a.statusReason).toBe("no_errors");
    expect(a.statusLabel).toBe("Workflow ran with no Errors");
  });

  it("fails closed when no classifier key is configured", async () => {
    const api = mockApi({
      getRules: () => [
        { name: "travel-sales", content: "Travel is booked to sales." },
      ],
      getClassifierKey: async () => null,
    });
    const res = await Tool_run(api);
    expect(res.status).toBe("success");
    expect(api._messages[0].json.workflowAudit.statusReason).toBe(
      "audit_unavailable",
    );
  });

  it("requires an active workflow", async () => {
    const api = mockApi({ getActiveWorkflow: () => null });
    const res = await Tool_run(api);
    expect(res.status).toBe("error");
  });
});
