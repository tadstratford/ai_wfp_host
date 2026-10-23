import { describe, expect, test } from "bun:test";
import { candidatePhrases, discoverRelationships, measureCoverage } from "./discover";

describe("candidatePhrases", () => {
  test("strips parentheticals and see-also tails", () => {
    expect(candidatePhrases("Tri-Mack (see also Project Patriot)")).toContain("tri-mack");
  });

  test("splits slash alternatives", () => {
    const phrases = candidatePhrases("Torrent Photonics / Resistance Optics");
    expect(phrases).toContain("torrent photonics");
    expect(phrases).toContain("resistance optics");
  });

  test("rejects short and numeric-only values", () => {
    expect(candidatePhrases("ab")).toEqual([]);
    expect(candidatePhrases("123")).toEqual([]);
  });
});

describe("discoverRelationships", () => {
  const schedule = {
    name: "dead_deals_dead_deals",
    columns: ["Deal Name", "Total Expenses", "EBITDA ($m)"],
    rows: [
      { "Deal Name": "Ironwave", "Total Expenses": "10935.79", "EBITDA ($m)": "8" },
      { "Deal Name": "Nyati Services", "Total Expenses": "14976.99", "EBITDA ($m)": "8" },
      { "Deal Name": "Control Panels USA", "Total Expenses": "12861.54", "EBITDA ($m)": "5" },
      { "Deal Name": "McQ", "Total Expenses": "9865.91", "EBITDA ($m)": "5" },
    ],
  };

  const ico = {
    name: "ico_report_sheet1",
    columns: ["Description", "Amount"],
    rows: [
      { Description: "Reclass Dead Deals transactions to Fund - Write off - Ironwave: Travel", Amount: "3823.47" },
      { Description: "Reclass Dead Deals transactions to Fund - Write off - Ironwave: Professional Fees", Amount: "3289.51" },
      { Description: "Reclass Dead Deals transactions to Fund - Write off - Ironwave: Meals", Amount: "81.70" },
      { Description: "Reclass Dead Deals transactions to Fund - Write off - Nyati Services: Travel", Amount: "1751.53" },
      { Description: "Reclass Dead Deals transactions to Fund - Write off - Control Panels USA: Travel", Amount: "8461.62" },
    ],
  };

  test("discovers a contains relationship from Deal Name to Description", () => {
    const rels = discoverRelationships([schedule, ico]);
    const rel = rels.find(
      (r) => r.left.table === "dead_deals_dead_deals" && r.left.column === "Deal Name" && r.right.column === "Description",
    );
    expect(rel).toBeDefined();
    expect(rel!.kind).toBe("contains");
    expect(rel!.coverage).toBeCloseTo(0.75);
    expect(rel!.source).toBe("deterministic");
  });

  test("does not discover a relationship from a numeric column", () => {
    const rels = discoverRelationships([schedule, ico]);
    const rel = rels.find((r) => r.left.column === "Total Expenses");
    expect(rel).toBeUndefined();
  });

  test("discovers a partial contains link (active deals never appear in the ledger)", () => {
    // 30 schedule rows (21 dead + 9 active); only 13 dead deals are written off,
    // so coverage is 13/30 ≈ 0.43 — below the old 0.5 gate but a real link.
    const names = Array.from({ length: 30 }, (_, i) => `Deal ${String(i + 1).padStart(2, "0")}`);
    const schedule30 = {
      name: "schedule_sheet1",
      columns: ["Deal Name", "Total Expenses"],
      rows: names.map((n) => ({ "Deal Name": n, "Total Expenses": "1000.00" })),
    };
    const ledger = {
      name: "ico_sheet1",
      columns: ["Description", "Amount"],
      rows: names.slice(0, 13).map((n) => ({ Description: `Write off - ${n}: Travel`, Amount: "100.00" })),
    };
    const rels = discoverRelationships([schedule30, ledger]);
    const rel = rels.find(
      (r) => r.left.table === "schedule_sheet1" && r.left.column === "Deal Name" && r.right.column === "Description",
    );
    expect(rel).toBeDefined();
    expect(rel!.kind).toBe("contains");
    expect(rel!.coverage).toBeCloseTo(13 / 30);
  });
});

describe("measureCoverage", () => {
  test("counts matched and unmatched left keys", () => {
    const left = [
      { name: "Ironwave" },
      { name: "McQ" },
    ];
    const right = [
      { text: "Write off - Ironwave: Travel" },
      { text: "Write off - Ironwave: Meals" },
    ];
    const cov = measureCoverage(left, "name", right, "text");
    expect(cov.contains.matched).toBe(1);
    expect(cov.contains.total).toBe(2);
  });
});
