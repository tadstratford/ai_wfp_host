import { describe, it, expect } from "bun:test";
import { classifyRule } from "./classifyRule";
import type { SelectedRule } from "./types";

function rule(name: string, content: string): SelectedRule {
  return { name, description: "", content, prob: 0.5 };
}

describe("classifyRule", () => {
  it("classifies a reconciliation rule as deterministic (reconcile_relationship)", () => {
    const c = classifyRule(rule("tie-out", "The schedule total must reconcile to the ledger."));
    expect(c.tier).toBe("deterministic");
    expect(c.tool).toBe("reconcile_relationship");
  });

  it("classifies a 50/50 allocation rule as deterministic (split_data)", () => {
    const c = classifyRule(rule("admin-alloc", "Admin should be allocated to marketing and sales 50/50."));
    expect(c.tier).toBe("deterministic");
    expect(c.tool).toBe("split_data");
  });

  it("classifies a membership rule as classified (check_data)", () => {
    const c = classifyRule(rule("equipment", "The equipment name must be in the equipment list."));
    expect(c.tier).toBe("classified");
    expect(c.tool).toBe("check_data");
  });

  it("defaults to audit when no tool keyword matches", () => {
    const c = classifyRule(rule("memo", "The memo should be clear and descriptive."));
    expect(c.tier).toBe("audit");
    expect(c.tool).toBeUndefined();
  });

  it("classifies a capability-tool (method) rule as audit, never split_data", () => {
    const c = classifyRule(rule(
      "shared-services-allocation",
      "Compute the split with `qbodemo_allocation_compute` and post with `qbodemo_journal_create`.",
    ));
    expect(c.tier).toBe("audit");
    expect(c.tool).toBeUndefined();
  });
});
