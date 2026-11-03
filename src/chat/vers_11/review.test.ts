import { describe, it, expect } from "bun:test";
import { buildReviewReportHtml, buildReviewWorkbookSheets, buildInstructionsSheet, shortSheetName, findingsDigest, deterministicPlan } from "./review";
import type { ReviewPayload } from "./review";

function payload(overrides: Partial<ReviewPayload> = {}): ReviewPayload {
  return {
    title: "Data review",
    nodes: [
      {
        id: "audit_report_ic_transactions",
        ref: "node-0",
        label: "audit report ic transactions",
        role: "ledger",
        rows: 18,
        columns: 13,
        dupRows: 0,
        nullCols: 3,
        nullColNames: ["Allocation Rule ID (4)", "Reviewed By (6)"],
      },
    ],
    edges: [
      {
        from: "audit_report_ic_transactions",
        to: "audit report ic report net intercompany position",
        ref: "edge-0",
        keyCol: "From Entity",
        kind: "aggregate",
        status: "variance",
        label: "From Entity · 2 differ ($10,010)",
        detail: "Summit Bright LLC $7,860; Clear Meridian LLC $2,150",
      },
    ],
    variances: [
      { key: "Summit Bright LLC", left: 52560, right: 44700, diff: 7860, ref: "var-0" },
    ],
    verdicts: [
      { category: "Completeness", severity: 0.9, summary: "1 key field blank", basis: "null columns present", ref: "verdict-0" },
      { category: "Cutoff / timing", severity: 0, summary: "timing clean", basis: "date_issues 0.00", ref: "verdict-1" },
    ],
    ...overrides,
  };
}

describe("buildReviewReportHtml", () => {
  it("renders verdicts, variances, findings, scope, and relationships", () => {
    const html = buildReviewReportHtml(payload());
    expect(html).toContain("<title>Data review</title>");
    expect(html).toContain("Verdicts");
    expect(html).toContain("Completeness");
    expect(html).toContain("Variances");
    expect(html).toContain("$7,860");
    expect(html).toContain("What needs to change or be added");
    expect(html).toContain("Scope");
    expect(html).toContain("Relationships");
  });

  it("escapes user/table text", () => {
    const html = buildReviewReportHtml(
      payload({ nodes: [{ id: "x", ref: "node-0", label: "a <b> & \"c\"", role: "other", rows: 1, columns: 1, dupRows: 0, nullCols: 0, nullColNames: [] }] }),
    );
    expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(html).not.toContain("<b>");
  });

  it("omits variances and findings sections when there are none", () => {
    const html = buildReviewReportHtml(
      payload({ variances: [], verdicts: [{ category: "Consistency", severity: 0, summary: "naming consistent", basis: "x", ref: "v0" }] }),
    );
    expect(html).not.toContain("Variances");
    expect(html).not.toContain("What needs to change or be added");
  });
});

describe("findingsDigest", () => {
  it("lists verdicts, variances, and blank columns with their refs", () => {
    const digest = findingsDigest(payload());
    expect(digest).toContain("[verdict-0] Completeness (0.90): 1 key field blank");
    expect(digest).toContain("[var-0] Summit Bright LLC: left 52560 vs right 44700 (diff 7860)");
    expect(digest).toContain("[node-0] audit report ic transactions: blank fields Allocation Rule ID (4), Reviewed By (6)");
    expect(digest).toContain("[verdict-1]"); // green verdicts are listed too (context for the LLM)
  });
});

describe("shortSheetName", () => {
  it("shortens long interco basis-table labels", () => {
    expect(shortSheetName("allocation basis tables headcount by entity july 2026")).toBe("headcount july 2026");
    expect(shortSheetName("allocation basis tables trailing quarter revenue by entity q2 2026")).toBe("trailing quarter revenue q2 2026");
    expect(shortSheetName("net intercompany position by entity pair")).toBe("Net position by entity pair");
    expect(shortSheetName("exceptions items requiring bookkeeper action")).toBe("Exceptions");
    expect(shortSheetName("ic transactions")).toBe("IC transactions");
  });

  it("passes through labels with no shared prefix", () => {
    expect(shortSheetName("elimination check")).toBe("elimination check");
    expect(shortSheetName("allocation rules")).toBe("allocation rules");
  });
});

describe("buildInstructionsSheet", () => {
  it("is a two-column lead sheet named Instructions", () => {
    const sheet = buildInstructionsSheet();
    expect(sheet.name).toBe("Instructions");
    expect(sheet.columns).toEqual(["Section", "Detail"]);
    expect(sheet.rows.length).toBeGreaterThan(0);
    expect(sheet.rows[0]).toHaveProperty("Section", "What is this?");
    expect(JSON.stringify(sheet.rows)).toContain("Deterministic");
  });
});

describe("buildReviewWorkbookSheets", () => {
  const resolveRows = (name: string) =>
    name === "audit_report_ic_transactions" ? [{ Date: "2026-01-01", Amount: 10 }] : null;

  it("uses friendly labels as sheet names and adds Verdicts/Variances sheets", () => {
    const sheets = buildReviewWorkbookSheets(payload(), resolveRows);
    const names = sheets.map((s) => s.name);
    expect(names).toContain("audit report ic transactions"); // friendly label, not the raw id
    expect(names).toContain("Verdicts");
    expect(names).toContain("Variances");
    expect(names).not.toContain("audit_report_ic_transactions");

    const verdicts = sheets.find((s) => s.name === "Verdicts")!;
    expect(verdicts.rows[0]).toMatchObject({ Category: "Completeness", Verdict: "Red" });
  });

  it("skips tables that resolve to no rows", () => {
    const sheets = buildReviewWorkbookSheets(payload(), () => null);
    expect(sheets.map((s) => s.name)).toEqual(["Verdicts", "Variances"]);
  });
});

describe("deterministicPlan", () => {
  it("proposes an action per non-green verdict and per variance", () => {
    const actions = deterministicPlan(payload());
    const labels = actions.map((a) => a.label);
    expect(labels.some((l) => l.includes("Completeness"))).toBe(true);
    expect(labels.some((l) => l.includes("Summit Bright LLC"))).toBe(true);
    expect(labels.some((l) => l.includes("Cutoff / timing"))).toBe(false);
    expect(actions.every((a) => a.refs.length > 0)).toBe(true);
  });

  it("returns empty when there are no findings", () => {
    const actions = deterministicPlan(
      payload({ variances: [], verdicts: [{ category: "Consistency", severity: 0, summary: "clean", basis: "x", ref: "v0" }] }),
    );
    expect(actions).toEqual([]);
  });
});
