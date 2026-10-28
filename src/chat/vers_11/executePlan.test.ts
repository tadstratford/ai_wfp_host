import { describe, it, expect } from "bun:test";
import { interpretRuleCheck } from "./executePlan";

describe("interpretRuleCheck", () => {
  it("flags a reconcile with mismatches", () => {
    const out = JSON.stringify({ summary: { matched: 9, mismatched: 1, missing_left: 0, missing_right: 0 } });
    expect(interpretRuleCheck("deterministic", out)).toBe("flag");
  });

  it("flags check_data with a high noul", () => {
    const out = JSON.stringify([{ id: "miscoded", noul: 0.82 }]);
    expect(interpretRuleCheck("classified", out)).toBe("flag");
  });

  it("passes a clean reconcile", () => {
    const out = JSON.stringify({ summary: { matched: 10, mismatched: 0, missing_left: 0, missing_right: 0 } });
    expect(interpretRuleCheck("deterministic", out)).toBe("done");
  });

  it("passes check_data with a low noul", () => {
    const out = JSON.stringify([{ id: "miscoded", noul: 0.1 }]);
    expect(interpretRuleCheck("classified", out)).toBe("done");
  });

  it("treats non-JSON output as done", () => {
    expect(interpretRuleCheck("deterministic", "some prose")).toBe("done");
  });
});
