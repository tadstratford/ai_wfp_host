import { describe, it, expect } from "bun:test";
import { interpretRuleCheck, renderGetDataResult } from "./executePlan";

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

describe("renderGetDataResult", () => {
  it("renders a single read as a markdown table", () => {
    const out = renderGetDataResult(JSON.stringify({
      name: "ledger", columns: ["Date", "Amount"], rows: [{ Date: "2026-01-01", Amount: 10 }], has_more: false,
    }));
    expect(out).toContain("| Date | Amount |");
    expect(out).toContain("| 2026-01-01 | 10 |");
  });

  it("renders a multi-read as named sections", () => {
    const out = renderGetDataResult(JSON.stringify({
      names: ["a", "b"], tables: [{ name: "a", rows: [{ X: 1 }] }, { name: "b", rows: [{ Y: 2 }] }], missing: [],
    }));
    expect(out).toContain("**a**");
    expect(out).toContain("| X |");
    expect(out).toContain("**b**");
  });

  it("renders json_cells as a keyed list", () => {
    const out = renderGetDataResult(JSON.stringify({ name: "sheet", content_type: "json_cells", cells: { a1: "Header", b2: "42" } }));
    expect(out).toContain("- a1: Header");
    expect(out).toContain("- b2: 42");
  });

  it("passes plain text through verbatim", () => {
    expect(renderGetDataResult('Data "x" not found.')).toBe('Data "x" not found.');
  });
});
