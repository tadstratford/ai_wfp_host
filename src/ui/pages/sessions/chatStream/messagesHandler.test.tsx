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
