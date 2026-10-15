import { describe, it, expect } from "bun:test";
import { extractParams } from "./extract";
import type { ToolParam } from "./schema";

const dateParams: ToolParam[] = [
  { name: "start_date", type: "string", required: true },
  { name: "end_date", type: "string", required: true },
];

describe("extractParams clarified fallback", () => {
  it("uses a clarified value when text does not resolve the param", () => {
    const result = extractParams("q", "no dates here", dateParams, {
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
    expect(result.values.start_date).toBe("2026-01-01");
    expect(result.values.end_date).toBe("2026-12-31");
    expect(result.params.find((p) => p.name === "start_date")?.source).toBe(
      "clarified",
    );
  });

  it("prefers text extraction over the clarified fallback", () => {
    const result = extractParams(
      "q",
      "from 2026-01-01 to 2026-03-31",
      dateParams,
      { start_date: "2025-01-01", end_date: "2025-12-31" },
    );
    expect(result.values.start_date).toBe("2026-01-01");
    expect(result.values.end_date).toBe("2026-03-31");
    expect(result.params.find((p) => p.name === "start_date")?.source).toBe(
      "extracted",
    );
  });

  it("leaves params missing when neither text nor fallback resolves", () => {
    const result = extractParams("q", "no dates", dateParams);
    expect(result.missingRequired).toEqual(["start_date", "end_date"]);
  });
});
