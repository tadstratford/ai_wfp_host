import { describe, it, expect } from "bun:test";
import { resolveInstruction, resolveMethod } from "./resolveMethod";
import type { ParsedRule } from "./ruleParse";

describe("resolveInstruction", () => {
  it("resolves a step that names a declared tool", () => {
    const o = resolveInstruction("Compute with `qbodemo_allocation_compute`.", ["qbodemo_allocation_compute"]);
    expect(o.rung).toBe("tool");
    expect(o.tool).toBe("qbodemo_allocation_compute");
  });

  it("resolves a split/measure step as spec", () => {
    expect(resolveInstruction("Split the total across the funds.", []).rung).toBe("spec");
  });

  it("resolves a yes/no step as judgment", () => {
    expect(resolveInstruction("Are any rows missing an amount?", []).rung).toBe("judgment");
  });

  it("resolves an unmatched step as gap", () => {
    expect(resolveInstruction("Ask the CFO how to weight this.", []).rung).toBe("gap");
  });
});

describe("resolveMethod", () => {
  const rule: ParsedRule = {
    instructions: [
      "Compute with `qbodemo_allocation_compute`.",
      "Split the total across the funds.",
      "Ask the CFO how to weight this.",
    ],
    tools: ["qbodemo_allocation_compute"],
    rules: [],
  };

  it("classifies each instruction without blocking", () => {
    const outcomes = resolveMethod(rule);
    expect(outcomes.map((o) => o.rung)).toEqual(["tool", "spec", "gap"]);
  });
});
