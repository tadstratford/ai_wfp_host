import { describe, it, expect } from "bun:test";
import { shouldVerify, verdictPasses } from "./verify";
import type { VerifyVerdict } from "./verify";

describe("shouldVerify", () => {
  it("verifies reviews, writes, and LLM-authored replies", () => {
    expect(shouldVerify({ reviewShaped: true, mutating: false, hasLlmAuthored: false })).toBe(true);
    expect(shouldVerify({ reviewShaped: false, mutating: true, hasLlmAuthored: false })).toBe(true);
    expect(shouldVerify({ reviewShaped: false, mutating: false, hasLlmAuthored: true })).toBe(true);
  });

  it("skips plain deterministic read turns", () => {
    expect(shouldVerify({ reviewShaped: false, mutating: false, hasLlmAuthored: false })).toBe(false);
  });
});

describe("verdictPasses", () => {
  const base: VerifyVerdict = { pass: true, satisfies: 0.8, complete: 0.8, accurate: 0.8, thorough: 0.8 };

  it("passes a clean verdict", () => {
    expect(verdictPasses(base)).toBe(true);
  });

  it("fails when any dimension is below its gate", () => {
    expect(verdictPasses({ ...base, accurate: 0.1 })).toBe(false);
    expect(verdictPasses({ ...base, complete: 0.1 })).toBe(false);
  });
});
