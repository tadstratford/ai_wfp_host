import { describe, expect, test } from "bun:test";
import { buildCellMap, cellMapToGrid } from "../../../stage";
import { longestCommonTokenRun } from "../entityKey";
import { statementDetailSpec } from "../specs";
import { applyShape } from "../apply";
import { classifyShapes } from "../classify";

const SINGLE_CELL = [
  "TTI Statement Detail,,,,,",
  "August 2026,,,,,",
  ",,,,,",
  '"1602 - IBVK147 BVK Venture 2014, L.P. - TTVII Series (Balance forward As of 08/01/2026)",,,,,',
  '"2026 07 I-Statement Reimbursement - IBVK147 BVK Venture 2014, L.P. - TTVII Series",,,,,',
  '"2026 07 I-Statement Management Fee - IBVK147 BVK Venture 2014, L.P. - TTVII Series",,,,,',
  '"1603 - ABC Corp (Balance forward As of 08/01/2026)",,,,,',
  '"2026 07 Distribution - ABC Corp",,,,,',
  "Total for TTVII Series,,,,,",
].join("\n");

function gridOf(csv: string): string[][] {
  const cm = buildCellMap(csv);
  if (!cm) throw new Error("buildCellMap returned null");
  return cellMapToGrid(cm.cells);
}

describe("longestCommonTokenRun", () => {
  test("extracts the shared entity identifier", () => {
    const a = "1602 - IBVK147 BVK Venture 2014, L.P. - TTVII Series (Balance forward As of 08/01/2026)";
    const b = "2026 07 I-Statement Reimbursement - IBVK147 BVK Venture 2014, L.P. - TTVII Series";
    expect(longestCommonTokenRun(a, b)).toBe(
      "IBVK147 BVK Venture 2014, L.P. - TTVII Series",
    );
  });

  test("returns null when there is no meaningful shared run", () => {
    expect(longestCommonTokenRun("1602 - ABC Corp", "2026 07 XYZ - Other")).toBeNull();
  });
});

describe("statementDetailSpec — single-cell memo layout", () => {
  test("fingerprint + classify match", () => {
    expect(statementDetailSpec.fingerprint!(gridOf(SINGLE_CELL))).toBe(true);
    expect(classifyShapes(gridOf(SINGLE_CELL)).map((c) => c.specId)).toContain(
      "statement_detail",
    );
  });

  test("apply pairs account with its memo lines and flags matches", () => {
    const table = applyShape(gridOf(SINGLE_CELL), statementDetailSpec);
    expect(table.columns).toEqual(["account", "entity_key", "memo", "matches"]);
    expect(table.rows).toHaveLength(3);

    expect(table.rows[0][2]).toContain("I-Statement Reimbursement");
    expect(table.rows[0][3]).toBe("true");
    expect(table.rows[1][0]).toContain("1602 - IBVK147");
    expect(table.rows[1][2]).toContain("I-Statement Management Fee");
    expect(table.rows[2][0]).toContain("1603 - ABC Corp");
    expect(table.rows[2][3]).toBe("true");
  });
});

describe("statementDetailSpec — column layout (odd rows)", () => {
  const COLUMN_LAYOUT = [
    "account,Doc dt.,Doc,Description,Department,Budget,Budget name,Vendor name,Txn No,JNL,Curr,Txn amt,Debit (USD),Credit (USD),Balance (USD)",
    '"1602 - IBVK147 BVK Venture 2014, L.P. - TTVII Series (Balance forward As of 08/01/2026)",,,,,,,,,,,,,,"11,160.00"',
    '8/27/26,8/27/26,,"2026 07 I-Statement Reimbursement - IBVK147 BVK Venture 2014, L.P. - TTVII Series",GA,OP_ONG,OPERATING/ONGOING,,5065,CRJ,USD,"6,000.00",,"6,000.00","5,160.00"',
    '"1603 - XYZ Corp (Balance forward As of 08/01/2026)",,,,,,,,,,,,,,"25,542.00"',
    '8/27/26,8/27/26,,"2026 07 Distribution - Some Other Fund",GA,OP_ONG,OPERATING/ONGOING,,5047,CRJ,USD,"25,542.00",,"25,542.00","0"',
  ].join("\n");

  test("associates transactions with the account above and flags a mismatch", () => {
    const table = applyShape(gridOf(COLUMN_LAYOUT), statementDetailSpec);
    expect(table.rows).toHaveLength(2);

    // First transaction belongs to 1602 and its memo names the entity.
    expect(table.rows[0][0]).toContain("1602 - IBVK147");
    expect(table.rows[0][1]).toBe("IBVK147 BVK Venture 2014, L.P. - TTVII Series");
    expect(table.rows[0][3]).toBe("true");

    // Second transaction is under 1603 but its memo does NOT name XYZ Corp.
    expect(table.rows[1][0]).toContain("1603 - XYZ Corp");
    expect(table.rows[1][2]).toBe("2026 07 Distribution - Some Other Fund");
    expect(table.rows[1][3]).toBe("false");
  });
});

describe("classifyShapes fallback", () => {
  test("returns flat_table when no shape fingerprint matches", () => {
    const g = cellMapToGrid(buildCellMap("a,b,c\n1,2,3")!.cells);
    const candidates = classifyShapes(g);
    expect(candidates).toEqual([{ specId: "flat_table", label: "Flat table", confidence: 0.5 }]);
  });
});
