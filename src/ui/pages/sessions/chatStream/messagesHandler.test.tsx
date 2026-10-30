import { test, expect, mock } from "bun:test";

// Mock the modules messagesHandler imports, then exercise the REAL handler.
mock.module("@backend/core/session/sessions/session_all", () => ({
  getSession: async () => ({
    session_id: "s1",
    instance_status: "awaiting_feedback",
    messages: [
      { id: "m1", role: "assistant", source: "vers_8", markdown: "> **Chat system**: v8", json: { system: true, kind: "system" } },
      { id: "m2", role: "user", source: "user", markdown: "hi", json: {} },
      { id: "m3", role: "assistant", source: "vers_8", html: "Jev call", json: { kind: "jev-call" } },
      { id: "m4", role: "assistant", source: "vers_8", markdown: "reply", json: { kind: "reply" } },
      { id: "m5", role: "assistant", source: "vers_8", html: "LLM call", json: { kind: "llm-call" } },
      { id: "m6", role: "assistant", source: "vers_11", markdown: "Figuring out what type of problem this is…", json: { kind: "thinking", stage: "classify-options", prompt: "Figuring out what type of problem this is…", options: [{ name: "report-authoring", prob: 0.94 }, { name: "budgeting", prob: 0.12 }] } },
      { id: "m7", role: "assistant", source: "vers_11", markdown: "Picked: report-authoring", json: { kind: "thinking", stage: "classify-outcome", chosen: ["report-authoring", "data-account-check"] } },
      { id: "m8", role: "assistant", source: "vers_11", markdown: "Figuring out which workspace rules apply…", json: { kind: "thinking", stage: "rules-options", prompt: "Figuring out which workspace rules apply…", options: [{ name: "shared-services-allocation", prob: 1 }] } },
      { id: "m9", role: "assistant", source: "vers_11", markdown: "Rules applying: shared-services-allocation (audit)", json: { kind: "thinking", stage: "rules-outcome", rules: [{ name: "shared-services-allocation", tier: "audit", prob: 1 }] } },
      { id: "m10", role: "assistant", source: "vers_11", markdown: "Tools: list_data", json: { kind: "thinking", stage: "tools", tools: [{ name: "list_data", label: "list_data", description: "List available data" }] } },
    ],
  }),
  updateSession: async () => {},
}));
mock.module("@backend/interfaces/streaming/simpleSSE", () => ({
  notifyClients: () => {},
}));
mock.module("./ApprovalActions", () => ({ ApprovalActions: () => null }));
mock.module("./InteractiveForm", () => ({ InteractiveForm: () => null }));
mock.module("./InlineAudit", () => ({ InlineAudit: () => null }));

const { messagesHandler } = await import("./messagesHandler");

test("messagesHandler collapses noise into <details>", async () => {
  let captured = "";
  const c = {
    req: { query: (k: string) => (k === "sessionId" ? "s1" : "") },
    get: () => ({ currentDatabaseId: "db1", chatVerbose: true, userEmail: "a@b.c", isAdmin: true }),
    html: (content: any) => {
      captured = String(content);
      return new Response(captured);
    },
  } as any;

  await messagesHandler(c);

  expect(captured).toContain("<details");
  expect(captured).toContain("<summary");
  expect(captured).toContain("Process details (3)");
  expect(captured).not.toContain(" open");
});

test("thinking messages render as content, not noise", async () => {
  let captured = "";
  const c = {
    req: { query: (k: string) => (k === "sessionId" ? "s1" : "") },
    get: () => ({ currentDatabaseId: "db1", chatVerbose: true, userEmail: "a@b.c", isAdmin: true }),
    html: (content: any) => {
      captured = String(content);
      return new Response(captured);
    },
  } as any;

  await messagesHandler(c);

  expect(captured).toContain("Figuring out what type of problem this is…");
  expect(captured).toContain("report-authoring");
  expect(captured).toContain("Picked:");
  expect(captured).toContain("Figuring out which workspace rules apply…");
  expect(captured).toContain("shared-services-allocation");
  expect(captured).toContain("Rules applying:");
  expect(captured).toContain("Tools");
  expect(captured).toContain("List available data");
  expect(captured).toContain("Process details (3)");
});
