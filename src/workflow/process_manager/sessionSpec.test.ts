import { describe, it, expect } from "bun:test";
import { specFromSession } from "./sessionSpec";
import type { Session } from "@backend/types";

function makeSession(toolCalls: any[]): Session {
  return {
    messages: [{ role: "user", markdown: "Build a cash flow forecast" }],
    metadata: { toolCalls },
  } as unknown as Session;
}

describe("specFromSession", () => {
  it("tags durable vs ephemeral tool calls from wf_indicator", () => {
    const spec = specFromSession(
      makeSession([
        {
          at: "t1",
          tools: [
            { tool: "list_data", args: "{}", wf_indicator: false },
            { tool: "get_data", args: '{"name":"bank_balances"}', wf_indicator: false },
            { tool: "save_data", args: "{}", wf_indicator: true },
            { tool: "chat_download", args: "{}", wf_indicator: true },
          ],
        },
      ]),
    );

    expect(spec).toContain("list_data [ephemeral]");
    expect(spec).toContain("get_data [ephemeral]");
    expect(spec).toContain("save_data [durable]");
    expect(spec).toContain("chat_download [durable]");
  });

  it("omits the tag for legacy records with no wf_indicator", () => {
    const spec = specFromSession(
      makeSession([{ at: "t1", tools: [{ tool: "get_data", args: "{}" }] }]),
    );

    expect(spec).toContain("get_data — args:");
    expect(spec).not.toContain("get_data [durable]");
    expect(spec).not.toContain("get_data [ephemeral]");
  });
});
