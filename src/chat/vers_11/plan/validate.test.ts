import { describe, it, expect } from "bun:test";
import { validatePlan } from "./validate";

describe("validatePlan (deterministic gates)", () => {
  it("rejects when required args are missing (no Jev call needed)", async () => {
    const verdict = await validatePlan({
      databaseId: "db1",
      userId: "u1",
      rawMessage: "sum the Amount column by Account",
      plan: {
        steps: [{ tool_id: "aggregate_data", tool_parameters: {}, label: "aggregate_data" }],
      },
      missingRequired: ["aggregate_data.measures"],
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.reason).toContain("aggregate_data.measures");
  });

  it("rejects an empty plan", async () => {
    const verdict = await validatePlan({
      databaseId: "db1",
      userId: "u1",
      rawMessage: "sum the Amount column by Account",
      plan: { steps: [] },
    });
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toBe("The plan has no steps.");
  });
});
