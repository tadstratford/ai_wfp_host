// Golden tests — lock the deterministic engines to hand-verified CP3 figures.
//
// These are characterization/regression tests: they assert that `profileTable`,
// `reconcileRelationship`, `evaluateRuleSpec`, and `splitAmount` reproduce the
// exact numbers that were verified by hand. If a future refactor changes the
// arithmetic (e.g. the amount-column bug that once picked "GL Account" over
// "Amount (USD)"), one of these fails immediately.

import { describe, expect, test } from "bun:test";
import { profileTable, parseAmount } from "../profile";
import { reconcileRelationship } from "../reconcileRelationship";
import { evaluateRuleSpec } from "../ruleApply";
import { splitAmount } from "../split";
import type { RuleSpec } from "wfp-format";
import { deadDealsTable, deadDealsRows, ironwaveLedgerRows, commitmentSplit, GOLDEN } from "./cp3";

function sumColumn(rows: Record<string, unknown>[], column: string): number {
  let total = 0;
  for (const r of rows) {
    const a = parseAmount(r[column]);
    if (a !== null) total += a;
  }
  return Math.round(total * 100) / 100;
}

describe("golden — CP3 schedule footing", () => {
  test("Fund I + Fund II = Total Expenses, and the totals match the verified figures", () => {
    expect(sumColumn(deadDealsRows, "Fund I Expenses")).toBeCloseTo(GOLDEN.fundITotal);
    expect(sumColumn(deadDealsRows, "Fund II Expenses")).toBeCloseTo(GOLDEN.fundIITotal);
    expect(sumColumn(deadDealsRows, "Total Expenses")).toBeCloseTo(GOLDEN.totalExpenses);

    const profile = profileTable(deadDealsTable, {
      footings: [{ leftColumn: "Total Expenses", rightColumns: ["Fund I Expenses", "Fund II Expenses"] }],
    });
    expect(profile.footings.length).toBe(1);
    expect(profile.footings[0].holds).toBe(true);
    expect(profile.footings[0].mismatchRows).toBe(0);
  });
});

describe("golden — CP3 Ironwave reconciliation", () => {
  test("the ledger detail is $3,204.01 short of the report, to the cent", () => {
    const result = reconcileRelationship({
      leftRows: deadDealsRows,
      rightRows: ironwaveLedgerRows,
      leftKey: "Deal Name",
      rightKey: "Description",
      kind: "contains",
      leftAmount: "Total Expenses",
      rightAmount: "Amount",
      tolerance: 0.01,
    });

    const ironwave = result.mismatches.find((m) => m.key === "Ironwave");
    expect(ironwave).toBeDefined();
    expect(ironwave!.left).toBeCloseTo(GOLDEN.ironwaveSchedule);
    expect(ironwave!.right).toBeCloseTo(GOLDEN.ironwaveLedger);
    expect(ironwave!.difference).toBeCloseTo(GOLDEN.ironwaveVariance);

    // Deals with no matching ledger rows are reported as missing on the right.
    expect(result.missing_right).toContain("McQ");
  });
});

describe("golden — CP3 EBITDA rule classification", () => {
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

  test("buckets 5 deals to Fund I, 15 to Fund II, 0 flagged, 10 unclassified", () => {
    const result = evaluateRuleSpec(spec, [deadDealsTable]);
    expect(result.applied).toBe(true);
    const byOutcome = Object.fromEntries(result.classifications!.map((c) => [c.outcome, c.count]));
    expect(byOutcome).toEqual({ "Fund I": 5, "Fund II": 15, unclassified: 10 });
  });
});

describe("golden — CP3 commitment split", () => {
  test("splits the schedule total 38.16 / 61.84 to the cent", () => {
    const shares = splitAmount(GOLDEN.totalExpenses, commitmentSplit);
    const byEntity = Object.fromEntries(shares.map((s) => [s.entity, s.amount]));
    expect(byEntity["Fund I family"]).toBeCloseTo(GOLDEN.splitFundI);
    expect(byEntity["Fund II family"]).toBeCloseTo(GOLDEN.splitFundII);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(GOLDEN.totalExpenses);
  });
});
