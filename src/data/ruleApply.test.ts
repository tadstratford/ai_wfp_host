import { describe, expect, test } from "bun:test";
import { evaluateRuleSpec } from "./ruleApply";
import type { RuleSpec } from "wfp-format";

const schedule = {
  name: "dead_deals_report_dead_deals",
  columns: ["Deal Name", "EBITDA ($m)"],
  columnTypes: { "Deal Name": "string", "EBITDA ($m)": "number" },
  rows: [
    { "Deal Name": "McQ", "EBITDA ($m)": 5 },
    { "Deal Name": "C-Flex", "EBITDA ($m)": 7 },
    { "Deal Name": "Compotech", "EBITDA ($m)": 7.5 },
    { "Deal Name": "Ironwave", "EBITDA ($m)": 8 },
    { "Deal Name": "Creare", "EBITDA ($m)": 17 },
  ],
};

describe("evaluateRuleSpec — classify", () => {
  const spec: RuleSpec = {
    kind: "classify",
    table: "dead_deals_report_dead_deals",
    outcomes: [
      { outcome: "Fund I", when: [{ column: "EBITDA ($m)", op: "lte", value: 7 }] },
      { outcome: "Fund II", when: [{ column: "EBITDA ($m)", op: "gte", value: 8 }] },
      {
        outcome: "flag",
        when: [
          { column: "EBITDA ($m)", op: "gt", value: 7 },
          { column: "EBITDA ($m)", op: "lt", value: 8 },
        ],
      },
    ],
    defaultOutcome: "unclassified",
  };

  test("buckets rows into the three outcomes", () => {
    const result = evaluateRuleSpec(spec, [schedule]);
    expect(result.applied).toBe(true);
    const byOutcome = Object.fromEntries(result.classifications!.map((c) => [c.outcome, c.count]));
    expect(byOutcome).toEqual({ "Fund I": 2, "Fund II": 2, flag: 1 });
  });
});

describe("evaluateRuleSpec — flag", () => {
  test("flags rows matching the predicate with a reason", () => {
    const spec: RuleSpec = {
      kind: "flag",
      table: "dead_deals_report_dead_deals",
      when: [
        { column: "EBITDA ($m)", op: "gt", value: 7 },
        { column: "EBITDA ($m)", op: "lt", value: 8 },
      ],
      reason: "manual review",
    };
    const result = evaluateRuleSpec(spec, [schedule]);
    expect(result.applied).toBe(true);
    expect(result.flags![0].count).toBe(1);
    expect(result.flags![0].reason).toBe("manual review");
  });
});

describe("evaluateRuleSpec — measure (cross-table split)", () => {
  const ico = {
    name: "ico_transactions_sheet1",
    columns: ["Description", "Amount"],
    columnTypes: { Description: "string", Amount: "number" },
    rows: [
      { Description: "subscription", Amount: 100 },
      { Description: "subscription 2", Amount: 50 },
    ],
  };

  test("splits the total by explicit percentages", () => {
    const spec: RuleSpec = {
      kind: "measure",
      table: "ico_transactions_sheet1",
      amountColumn: "Amount",
      split: [
        { entity: "Fund I", percent: 38.16 },
        { entity: "Fund II", percent: 61.84 },
      ],
    };
    const result = evaluateRuleSpec(spec, [ico]);
    expect(result.applied).toBe(true);
    expect(result.total).toBeCloseTo(150);
    const byEntity = Object.fromEntries(result.allocations!.map((a) => [a.entity, a.total]));
    expect(byEntity["Fund I"]).toBeCloseTo(57.24);
    expect(byEntity["Fund II"]).toBeCloseTo(92.76);
  });

  test("reads the split from a second table", () => {
    const commitments = {
      name: "estimated_commitments",
      columns: ["Fund", "Split"],
      columnTypes: { Fund: "string", Split: "number" },
      rows: [
        { Fund: "Fund I", Split: 38.16 },
        { Fund: "Fund II", Split: 61.84 },
      ],
    };
    const spec: RuleSpec = {
      kind: "measure",
      table: "ico_transactions_sheet1",
      amountColumn: "Amount",
      splitTable: "estimated_commitments",
      splitEntityColumn: "Fund",
      splitPercentColumn: "Split",
    };
    const result = evaluateRuleSpec(spec, [ico, commitments]);
    expect(result.applied).toBe(true);
    const byEntity = Object.fromEntries(result.allocations!.map((a) => [a.entity, a.total]));
    expect(byEntity["Fund I"]).toBeCloseTo(57.24);
    expect(byEntity["Fund II"]).toBeCloseTo(92.76);
  });
});

describe("evaluateRuleSpec — non-applicability", () => {
  test("reports a missing table as awaiting data", () => {
    const spec: RuleSpec = {
      kind: "classify",
      table: "not_loaded",
      outcomes: [{ outcome: "x", when: [{ column: "c", op: "eq", value: 1 }] }],
    };
    const result = evaluateRuleSpec(spec, [schedule]);
    expect(result.applied).toBe(false);
    expect(result.needs).toContain("table:not_loaded");
  });

  test("reports a missing column as awaiting data", () => {
    const spec: RuleSpec = {
      kind: "flag",
      table: "dead_deals_report_dead_deals",
      when: [{ column: "Nope", op: "gt", value: 1 }],
    };
    const result = evaluateRuleSpec(spec, [schedule]);
    expect(result.applied).toBe(false);
    expect(result.needs).toContain("column:Nope");
  });
});
