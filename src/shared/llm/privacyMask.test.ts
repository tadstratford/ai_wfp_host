import { describe, expect, test } from "bun:test";
import { maskCallOptions, unmaskResult } from "./privacyMask";

describe("unmaskResult", () => {
  test("reverses exact stand-ins", () => {
    const out = unmaskResult(
      { text: "loans to Pioneer West LP" },
      new Map([["Franklin Fund LP", "Pioneer West LP"]]),
    );
    expect(out.text).toBe("loans to Franklin Fund LP");
  });

  test("reverses suffix-dropped org stand-ins", () => {
    const out = unmaskResult(
      { text: "The intercompany loans to Pioneer West settled." },
      new Map([["Franklin Fund LP", "Pioneer West LP"]]),
    );
    expect(out.text).toBe("The intercompany loans to Franklin Fund LP settled.");
  });

  test("leaves unrelated text untouched", () => {
    const out = unmaskResult(
      { text: "The counterparty balance is zero." },
      new Map([["Franklin Fund LP", "Pioneer West LP"]]),
    );
    expect(out.text).toBe("The counterparty balance is zero.");
  });

  test("does not strip suffix when real and fake suffixes differ", () => {
    const out = unmaskResult(
      { text: "loans to Pioneer West" },
      new Map([["Acme Corp", "Pioneer West LP"]]),
    );
    expect(out.text).toBe("loans to Pioneer West");
  });

  test("reverses inside tool-call args", () => {
    const out = unmaskResult(
      { toolCall: { name: "show_message", args: { message: "see Pioneer West LP" } } },
      new Map([["Franklin Fund LP", "Pioneer West LP"]]),
    );
    expect(out.toolCall.args.message).toBe("see Franklin Fund LP");
  });
});

describe("maskCallOptions", () => {
  test("masks tool_result content blocks", () => {
    const opts = {
      system: "sys",
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "1", content: '{"vendor":"Acme Corp"}' },
          ],
        },
      ],
    };
    const { opts: masked } = maskCallOptions(opts, new Map([["Acme Corp", "Fake Inc"]]));
    expect(masked.messages[0].content[0].content).toBe('{"vendor":"Fake Inc"}');
  });

  test("masks string and text-block content", () => {
    const opts = {
      system: "Acme Corp system",
      messages: [
        { role: "user", content: "hello Acme Corp" },
        { role: "assistant", content: [{ type: "text", text: "Acme Corp here" }] },
      ],
    };
    const { opts: masked } = maskCallOptions(opts, new Map([["Acme Corp", "Fake Inc"]]));
    expect(masked.system).toBe("Fake Inc system");
    expect(masked.messages[0].content).toBe("hello Fake Inc");
    expect(masked.messages[1].content[0].text).toBe("Fake Inc here");
  });
});
