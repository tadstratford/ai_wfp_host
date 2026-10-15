import { describe, it, expect } from "bun:test";
import { buildDrilldownReportHtml } from "@capabilities/data/drilldown";

describe("buildDrilldownReportHtml", () => {
  const summary = [{ "GL Account": "1200", "sum_Amount (USD)": 144660 }];
  const details = [
    { "GL Account": 1200, "Txn ID": "IC-1008", "Amount (USD)": 27960 },
    { "GL Account": 6110, "Txn ID": "IC-1001", "Amount (USD)": 18500 },
  ];

  it("produces a self-contained deterministic HTML document", () => {
    const html = buildDrilldownReportHtml({
      workspace: "Test Co",
      title: "Amount by GL Account",
      summaryRows: summary,
      detailRows: details,
      groupBy: ["GL Account"],
      detailColumns: ["Txn ID", "Amount (USD)"],
      sources: ["staging_x", "raw"],
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Test Co");
    expect(html).toContain("Amount by GL Account");
    expect(html).toContain("Deterministic");
    expect(html).toContain("no AI");
  });

  it("joins details to summary across a numeric/string group-key mismatch", () => {
    const html = buildDrilldownReportHtml({
      workspace: "Test Co",
      title: "R",
      summaryRows: summary,
      detailRows: details,
      groupBy: ["GL Account"],
      detailColumns: ["Txn ID"],
      sources: [],
    });

    // "1200" (summary, string) matches detail 1200 (number).
    expect(html).toContain("IC-1008");
    // The other account's detail must NOT appear under the 1200 group.
    expect(html).not.toContain("IC-1001");
    expect(html).toContain("(1)");
  });

  it("formats numeric measure cells but not group cells", () => {
    const html = buildDrilldownReportHtml({
      workspace: "Test Co",
      title: "R",
      summaryRows: summary,
      detailRows: [],
      groupBy: ["GL Account"],
      detailColumns: [],
      sources: [],
    });

    expect(html).toContain("144,660");
    expect(html).not.toContain(">1,200<");
  });

  it("renders an empty-state when there are no summary rows", () => {
    const html = buildDrilldownReportHtml({
      workspace: "Test Co",
      title: "R",
      summaryRows: [],
      detailRows: details,
      groupBy: ["GL Account"],
      detailColumns: ["Txn ID"],
      sources: [],
    });
    expect(html).toContain("No data to display");
  });
});
