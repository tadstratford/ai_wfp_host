import { describe, expect, test } from "bun:test";
import { normalizeData } from "../index";
import { resolveConfig } from "../config";

const STATEMENT = [
  "account,Doc dt.,Doc,Description,Department,Budget,Budget name,Vendor name,Txn No,JNL,Curr,Txn amt,Debit (USD),Credit (USD),Balance (USD)",
  '"1602 - IBVK147 BVK Venture 2014, L.P. - TTVII Series (Balance forward As of 08/01/2026)",,,,,,,,,,,,,,"11,160.00"',
  '8/27/26,8/27/26,,"2026 07 I-Statement Reimbursement - IBVK147 BVK Venture 2014, L.P. - TTVII Series",GA,OP_ONG,OPERATING/ONGOING,,5065,CRJ,USD,"6,000.00",,"6,000.00","5,160.00"',
  '"1603 - XYZ Corp (Balance forward As of 08/01/2026)",,,,,,,,,,,,,,"25,542.00"',
  '8/27/26,8/27/26,,"2026 07 Distribution - Some Other Fund",GA,OP_ONG,OPERATING/ONGOING,,5047,CRJ,USD,"25,542.00",,"25,542.00","0"',
].join("\n");

describe("normalizeData — statement detail", () => {
  test("produces normalized accounts + transactions with foreign keys", () => {
    const ds = normalizeData(STATEMENT, resolveConfig("financeStatement"));
    const names = ds.tables.map((t) => t.name);
    expect(names).toContain("accounts");
    expect(names).toContain("transactions");

    const accounts = ds.tables.find((t) => t.name === "accounts")!;
    expect(accounts.rows).toHaveLength(2);
    expect(accounts.rows[0].name).toContain("1602 - IBVK147");
    expect(accounts.rows[0].entity_key).toBe("IBVK147 BVK Venture 2014, L.P. - TTVII Series");
    expect(accounts.rows[1].entity_key).toBe("XYZ Corp");

    const tx = ds.tables.find((t) => t.name === "transactions")!;
    expect(tx.rows).toHaveLength(2);
    expect(tx.rows[0].account_fk).toBe(0);
    expect(tx.rows[0].matches).toBe(true);
    expect(tx.rows[1].account_fk).toBe(1);
    expect(tx.rows[1].matches).toBe(false);
    expect(tx.foreignKeys?.[0]).toEqual({
      column: "account_fk",
      references: { table: "accounts", column: "id" },
    });
  });

  test("generic flat csv becomes a single normalized rows table", () => {
    const ds = normalizeData("a,b,c\n1,2,3\n4,5,6");
    expect(ds.tables).toHaveLength(1);
    expect(ds.tables[0].name).toBe("rows");
    expect(ds.tables[0].rows).toHaveLength(2);
  });
});
