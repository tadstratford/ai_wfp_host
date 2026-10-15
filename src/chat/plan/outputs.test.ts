import { describe, it, expect } from "bun:test";
import { getToolOutput, saveTypeFor } from "./outputs";
// Import the capabilities that declare their tools' result contracts (the
// capability modules self-register at import, calling declareResult per tool).
import "../../capabilities/data/capability";
import "@mcp/servers/app-wfp-sessions";
import "../../capabilities/judge/capability";

describe("tool output registry", () => {
  it("declares aggregate_data as a tabular producer", () => {
    expect(getToolOutput("aggregate_data")).toEqual({ type: "json_object", tabular: true });
    expect(saveTypeFor("aggregate_data")).toBe("json_array");
  });

  it("declares get_data as tabular (rows)", () => {
    expect(saveTypeFor("get_data")).toBe("json_array");
  });

  it("declares judge_data as a non-tabular object", () => {
    expect(getToolOutput("judge_data")).toEqual({ type: "json_object", tabular: false });
    expect(saveTypeFor("judge_data")).toBe("json_object");
  });

  it("declares check_data as a non-tabular object", () => {
    expect(getToolOutput("check_data")).toEqual({ type: "json_object", tabular: false });
    expect(saveTypeFor("check_data")).toBe("json_object");
  });

  it("defaults unknown tools to an opaque json_object", () => {
    expect(getToolOutput("some_mystery_tool")).toEqual({ type: "json_object", tabular: false });
    expect(saveTypeFor("some_mystery_tool")).toBe("json_object");
  });

  it("marks side-effect tools as text", () => {
    expect(getToolOutput("save_data")).toEqual({ type: "text", tabular: false });
    expect(getToolOutput("chat_download")).toEqual({ type: "text", tabular: false });
  });
});
