import { describe, expect, test } from "bun:test";
import { reconcileRelationship } from "./reconcileRelationship";

describe("reconcileRelationship — contains", () => {
  const left = [
    { "Deal Name": "Ironwave", "Total Expenses": "10935.79" },
    { "Deal Name": "Nyati Services", "Total Expenses": "14976.99" },
    { "Deal Name": "Control Panels USA", "Total Expenses": "12861.54" },
    { "Deal Name": "McQ", "Total Expenses": "9865.91" },
  ];
  const right = [
    { Description: "Write off - Ironwave: Travel", Amount: "3823.47" },
    { Description: "Write off - Ironwave: Professional Fees", Amount: "3289.51" },
    { Description: "Write off - Ironwave: Meals", Amount: "81.70" },
    { Description: "Write off - Nyati Services: Travel", Amount: "1751.53" },
    { Description: "Write off - Control Panels USA: Travel", Amount: "8461.62" },
  ];

  const result = reconcileRelationship({
    leftRows: left,
    rightRows: right,
    leftKey: "Deal Name",
    rightKey: "Description",
    kind: "contains",
    leftAmount: "Total Expenses",
    rightAmount: "Amount",
  });

  test("sums Ironwave's write-offs and reports the variance", () => {
    const m = result.mismatches.find((x) => x.key === "Ironwave");
    expect(m).toBeDefined();
    expect(m!.right).toBeCloseTo(7194.68);
    expect(m!.difference).toBeCloseTo(-3741.11);
  });

  test("flags McQ as missing on the right", () => {
    expect(result.missing_right).toContain("McQ");
  });

  test("summary counts three mismatches and one missing-right", () => {
    expect(result.summary.mismatched).toBe(3);
    expect(result.summary.missing_right).toBe(1);
    expect(result.summary.missing_left).toBe(0);
  });
});

describe("reconcileRelationship — aliases", () => {
  test("maps an alias to its canonical key", () => {
    const left = [{ "Deal Name": "Tri-Mack (see also Project Patriot)", "Total Expenses": "8386.65" }];
    const right = [{ Description: "Write off - Project Patriot: Travel", Amount: "100.00" }];
    const result = reconcileRelationship({
      leftRows: left,
      rightRows: right,
      leftKey: "Deal Name",
      rightKey: "Description",
      kind: "contains",
      leftAmount: "Total Expenses",
      rightAmount: "Amount",
      aliases: { "project patriot": "Tri-Mack (see also Project Patriot)" },
    });
    expect(result.summary.missing_right).toBe(0);
    expect(result.mismatches[0].key).toBe("Tri-Mack (see also Project Patriot)");
  });
});
