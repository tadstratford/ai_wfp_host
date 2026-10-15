import { describe, it, expect } from "bun:test";
import {
  matchColumnNames,
  detectAggFn,
  extractGroupBy,
  synthesizeMeasures,
  synthesizeStructuredArgs,
} from "./args";

describe("matchColumnNames", () => {
  it("does not match a substring column inside a longer one", () => {
    expect(matchColumnNames("by Account", ["Amount", "Account", "GL Account", "Description"])).toEqual(["Account"]);
  });

  it("matches the longer name when it is named verbatim", () => {
    expect(matchColumnNames("by GL Account", ["Amount", "Account", "GL Account", "Description"])).toEqual(["GL Account"]);
  });

  it("maps a bare token to a decorated column name", () => {
    // "Amount" → "Amount (USD)" and "Account" → "GL Account" via distinctive tokens.
    expect(matchColumnNames("sum Amount by Account", ["Txn ID", "Amount (USD)", "GL Account"])).toEqual([
      "Amount (USD)",
      "GL Account",
    ]);
  });

  it("resolves a head-noun token to the code column, not the description", () => {
    expect(
      matchColumnNames("by Account", ["Txn ID", "Amount (USD)", "GL Account", "Account Description"]),
    ).toEqual(["GL Account"]);
  });
});

describe("detectAggFn", () => {
  it("maps common aggregation words to the canonical fn", () => {
    expect(detectAggFn("sum the Amount")).toBe("sum");
    expect(detectAggFn("count how many rows")).toBe("count");
    expect(detectAggFn("average of Amount")).toBe("avg");
    expect(detectAggFn("max of Amount")).toBe("max");
    expect(detectAggFn("just show me the data")).toBeNull();
  });
});

describe("synthesizeStructuredArgs", () => {
  it("fills aggregate_data measures/group_by for 'sum X by Y'", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "sum the Amount column of interco_audit_demo_ic_transactions by Account",
      ["Amount", "Account", "GL Account", "Description"],
    );
    expect(args).toEqual({
      group_by: ["Account"],
      measures: [{ column: "Amount", fn: "sum" }],
    });
  });

  it("maps decorated column names via tokens", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "sum the Amount column of interco_audit_demo_ic_transactions by Account",
      ["Txn ID", "Amount (USD)", "GL Account", "Description"],
    );
    expect(args).toEqual({
      group_by: ["GL Account"],
      measures: [{ column: "Amount (USD)", fn: "sum" }],
    });
  });

  it("maps 'by Account' to GL Account over Account Description (head noun)", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "sum the Amount column of interco_audit_demo_ic_transactions by Account",
      ["Txn ID", "Amount (USD)", "GL Account", "Account Description", "Status"],
    );
    expect(args).toEqual({
      group_by: ["GL Account"],
      measures: [{ column: "Amount (USD)", fn: "sum" }],
    });
  });

  it("does not guess a measure column (no first-column fallback)", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "sum the Amount by Account",
      ["Txn ID", "GL Account", "Description"], // no amount column at all
    );
    expect(args).toEqual({});
  });

  it("bails when a grouping is requested but unresolvable", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "sum the Amount by Region",
      ["Amount", "Txn ID", "Description"], // no region-like column
    );
    expect(args).toEqual({});
  });

  it("returns nothing for a non-aggregation request", () => {
    const args = synthesizeStructuredArgs(
      "aggregate_data",
      "show me interco_audit_demo_ic_transactions",
      ["Amount", "Account"],
    );
    expect(args).toEqual({});
  });

  it("returns nothing for a non-aggregate tool", () => {
    const args = synthesizeStructuredArgs("get_data", "sum Amount by Account", ["Amount", "Account"]);
    expect(args).toEqual({});
  });
});

describe("synthesizeMeasures", () => {
  it("picks the non-group-by column as the measure", () => {
    const groupBy = extractGroupBy("sum Amount by Account", ["Amount", "Account"]);
    expect(groupBy).toEqual(["Account"]);
    expect(synthesizeMeasures("sum Amount by Account", ["Amount", "Account"], groupBy)).toEqual({
      column: "Amount",
      fn: "sum",
    });
  });
});
