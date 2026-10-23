import { describe, expect, test } from "bun:test";
import { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";
import { buildDataCatalog } from "./index";

function makeSession(): WorkspaceSession {
  return new WorkspaceSession({
    userId: "user-1",
    workspaceId: "ws-1",
    wfp: {
      metadata: { format_version: "1.0.0", workspace: "Test" },
      workflows: [],
      tools: [],
      data: {},
      knowledge: [],
      sessions: [],
      provenance: [],
      privacy_mask: { entries: [] },
    },
    secret: null,
  });
}

const ICO_CSV = [
  "Description,Amount",
  '"Reclass Dead Deals transactions to Fund - Write off - Ironwave: Travel",3823.47',
  '"Reclass Dead Deals transactions to Fund - Write off - Ironwave: Meals",81.70',
  '"Reclass Dead Deals transactions to Fund - Write off - Nyati Services: Travel",1751.53',
  '"Reclass Dead Deals transactions to Fund - Write off - Control Panels USA: Travel",8461.62',
].join("\n");

const DEALS_CSV = [
  "Deal Name,Total Expenses",
  "Ironwave,10935.79",
  "Nyati Services,14976.99",
  "Control Panels USA,12861.54",
  "McQ,9865.91",
].join("\n");

// A "large" QuickBooks journal export has a title preamble before the real
// header, and a leading blank key column (col_1) that carries the account group.
const ICO_PREAMBLE_CSV = [
  "Cogenuity Partners LLC,,,,,,,,,,,",
  "Intercompany Report,,,,,,,,,,,",
  '"January-September, 2026",,,,,,,,,,,',
  ",,,,,,,,,,,",
  ",Transaction date,Transaction type,Num,Adj,Name,Description,Account Name,Item split account,Amount,Balance,Item class",
  ",9/30/26,Journal Entry,337,No,,Reclass Dead Deals transactions to Funds - Write off - Ironwave: Travel,1200 Intercompany:1225 A/R - Due from Fund II,,3823.47,229802.16,Travel",
  ",9/30/26,Journal Entry,337,No,,Reclass Dead Deals transactions to Funds - Write off - Ironwave: Professional Fees,1200 Intercompany:1225 A/R - Due from Fund II,,3289.51,225978.69,Professional Fees",
  ",9/30/26,Journal Entry,337,No,,Reclass Dead Deals transactions to Funds - Write off - Nyati Services: Travel,1200 Intercompany:1225 A/R - Due from Fund II,,8427.44,259550.75,Travel",
  ",9/30/26,Journal Entry,337,No,,Reclass Dead Deals transactions to Funds - Write off - Control Panels USA: Travel,1200 Intercompany:1225 A/R - Due from Fund II,,6620.73,192816.72,Travel",
].join("\n");

const ICO_COLUMNS = [
  "col_1", "Transaction date", "Transaction type", "Num", "Adj", "Name",
  "Description", "Account Name", "Item split account", "Amount", "Balance", "Item class",
];

describe("buildDataCatalog", () => {
  test("discovers a relationship even when the right table is marked large", () => {
    const s = makeSession();
    s.setDataEntry("dead_deals", { content: DEALS_CSV, content_type: "csv", columns: ["Deal Name", "Total Expenses"], row_count: 4 });
    s.setDataEntry("ico", {
      content: ICO_CSV,
      content_type: "csv",
      columns: ["Description", "Amount"],
      row_count: 4,
      large: true, // regression: large entries must still be discovered
    });

    const catalog = buildDataCatalog(s);
    const rel = catalog.relationships.find(
      (r) => r.left.table === "dead_deals" && r.left.column === "Deal Name" && r.right.table === "ico" && r.right.column === "Description",
    );
    expect(rel).toBeDefined();
    expect(rel!.kind).toBe("contains");
  });

  test("materializes a large entry past its title preamble using header_row + key_columns", () => {
    const s = makeSession();
    s.setDataEntry("dead_deals", { content: DEALS_CSV, content_type: "csv", columns: ["Deal Name", "Total Expenses"], row_count: 4 });
    s.setDataEntry("ico", {
      content: ICO_PREAMBLE_CSV,
      content_type: "csv",
      columns: ICO_COLUMNS,
      row_count: 4,
      large: true,
      header_row: 4, // the real header sits below 4 preamble lines
      key_columns: ["col_1"],
    });

    const catalog = buildDataCatalog(s);
    const rel = catalog.relationships.find(
      (r) => r.left.table === "dead_deals" && r.left.column === "Deal Name" && r.right.table === "ico" && r.right.column === "Description",
    );
    expect(rel).toBeDefined();
    expect(rel!.kind).toBe("contains");
    expect(rel!.coverage).toBeCloseTo(0.75);
  });
});
