/**
 * Verify the `element` field propagation works correctly.
 */
import { describe, it, expect } from "bun:test";
import type { Session, Message } from "@backend/types";

const { createWFP_API } = await import("./createAPI");

const makeSession = (id: string): Session =>
  ({
    session_id: id,
    name: "Test",
    version: 1,
    messages: [],
    parameters: [],
    metadata: {},
    workflows: {},
    activeWorkflowId: null,
    user_id: "u1",
    created_at: new Date(),
    updated_at: new Date(),
    waitingForInput: false,
    instance_status: "in_progress",
    status: "in_progress",
    sessions: [],
    shared_sessions: [],
    summary: null,
  } as any);

describe("addMessage element propagation", () => {
  it("sets element on the host message when passed via addMessage", () => {
    const session = makeSession("test-session");
    const api = createWFP_API(session, "test-db", "test-tool");
    const elementRef = { name: "gl-accounts", mode: "edit" };
    (api as any).addMessage({ element: elementRef } as any);

    expect(session.messages.length).toBeGreaterThan(0);
    const msg = session.messages[0] as any;
    expect(msg.element).toEqual(elementRef);
  });

  it("does not set element when not provided", () => {
    const session = makeSession("test-session-2");
    const api = createWFP_API(session, "test-db", "test-tool");
    (api as any).addMessage({ markdown: "hello" } as any);

    const msg = session.messages[0] as any;
    expect(msg.element).toBeUndefined();
  });
});
