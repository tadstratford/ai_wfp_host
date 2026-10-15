import { describe, it, expect } from "bun:test";
import { buildQboStatementHtml, mergeStatementMonths } from "./statementReport";

describe("buildQboStatementHtml", () => {
  it("renders sections, indented line items, and ruled subtotals", () => {
    const html = buildQboStatementHtml({
      workspace: "Acme",
      company: "Acme Corp",
      title: "Profit and Loss",
      period: "2026-01-01 – 2026-01-31",
      currency: "USD",
      accountingMethod: "Accrual",
      columns: ["Total"],
      rows: [
        { kind: "section", label: "Income", depth: 0, values: [] },
        { kind: "data", label: "Sales", depth: 1, values: ["41,200.00"] },
        { kind: "summary", label: "Total Income", depth: 0, values: ["41,200.00"] },
      ],
      note: null,
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Profit and Loss");
    expect(html).toContain("<tr class=\"sect\"><td colspan=\"2\">Income</td></tr>");
    expect(html).toContain("padding-left:24px"); // depth 1 → 8 + 16px indent
    expect(html).toContain("$41,200.00");
    expect(html).toContain("<tr class=\"sum\">");
    expect(html).toContain("Deterministic");
  });

  it("renders a month-by-month statement with one column per period", () => {
    const html = buildQboStatementHtml({
      workspace: "Acme",
      company: null,
      title: "Profit and Loss",
      period: "2026-01-01 – 2026-02-28",
      currency: "USD",
      accountingMethod: "Accrual",
      columns: ["Jan 2026", "Feb 2026"],
      rows: [
        { kind: "section", label: "Income", depth: 0, values: [] },
        { kind: "data", label: "Sales", depth: 1, values: ["1,000.00", "2,000.00"] },
      ],
      note: null,
    });

    expect(html).toContain("<th class=\"num\">Jan 2026</th>");
    expect(html).toContain("<th class=\"num\">Feb 2026</th>");
    expect(html).toContain("<tr class=\"sect\"><td colspan=\"3\">Income</td></tr>");
  });

  it("escapes user text and handles an empty report", () => {
    const html = buildQboStatementHtml({
      workspace: "A&B",
      company: "<script>",
      title: "Balance Sheet",
      period: "",
      currency: "USD",
      accountingMethod: "Accrual",
      columns: ["Total"],
      rows: [],
      note: null,
    });

    expect(html).toContain("No data to display.");
    expect(html).not.toContain("<script>");
    expect(html).toContain("A&amp;B");
  });
});

describe("mergeStatementMonths", () => {
  it("merges per-month rows into a multi-column matrix aligned by id", () => {
    const merged = mergeStatementMonths([
      {
        period: "2026-01",
        rows: [
          { kind: "section", group: "Income", depth: 0, id: "Income", label: "Income", value: "" },
          { kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "100.00" },
          { kind: "summary", group: "NetIncome", depth: 0, id: "NetIncome", label: "Net Income", value: "100.00" },
        ],
      },
      {
        period: "2026-02",
        rows: [
          { kind: "section", group: "Income", depth: 0, id: "Income", label: "Income", value: "" },
          { kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "200.00" },
          { kind: "summary", group: "NetIncome", depth: 0, id: "NetIncome", label: "Net Income", value: "200.00" },
        ],
      },
    ]);

    expect(merged.columns).toEqual(["2026-01", "2026-02"]);
    expect(merged.rows.map((r) => r.label)).toEqual(["Income", "Sales", "Net Income"]);
    expect(merged.rows[0].kind).toBe("section");
    expect(merged.rows[1].values).toEqual(["100.00", "200.00"]);
    expect(merged.rows[1].depth).toBe(1);
  });

  it("fills empty cells when a month is missing a row", () => {
    const merged = mergeStatementMonths([
      {
        period: "2026-01",
        rows: [{ kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "100.00" }],
      },
      {
        period: "2026-02",
        rows: [
          { kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "200.00" },
          { kind: "data", group: "", depth: 1, id: "56", label: "Fees", value: "10.00" },
        ],
      },
    ]);

    const sales = merged.rows.find((r) => r.label === "Sales")!;
    const fees = merged.rows.find((r) => r.label === "Fees")!;
    expect(sales.values).toEqual(["100.00", "200.00"]);
    expect(fees.values).toEqual(["", "10.00"]);
  });

  it("keeps a precomputed Total entry as the right column", () => {
    const merged = mergeStatementMonths([
      {
        period: "2026-01",
        rows: [{ kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "100.00" }],
      },
      {
        period: "2026-02",
        rows: [{ kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "200.00" }],
      },
      {
        period: "Total",
        rows: [{ kind: "data", group: "", depth: 1, id: "55", label: "Sales", value: "299.99" }],
      },
    ]);

    expect(merged.columns).toEqual(["2026-01", "2026-02", "Total"]);
    const sales = merged.rows.find((r) => r.label === "Sales")!;
    expect(sales.values).toEqual(["100.00", "200.00", "299.99"]);
  });

  it("orders rows by an orderSource (canonical account order)", () => {
    const merged = mergeStatementMonths(
      [
        {
          period: "2026-01",
          rows: [
            { kind: "data", group: "", depth: 1, id: "1", label: "Lawyer", value: "300.00" },
            { kind: "summary", group: "NetOperatingIncome", depth: 0, id: "NetOperatingIncome", label: "Net Operating Income", value: "-300.00" },
          ],
        },
        {
          period: "2026-02",
          rows: [
            { kind: "data", group: "", depth: 1, id: "2", label: "Plants and Soil", value: "131.25" },
          ],
        },
      ],
      [
        { kind: "data", group: "", depth: 1, id: "1", label: "Lawyer", value: "300.00" },
        { kind: "data", group: "", depth: 1, id: "2", label: "Plants and Soil", value: "131.25" },
        { kind: "summary", group: "NetOperatingIncome", depth: 0, id: "NetOperatingIncome", label: "Net Operating Income", value: "-168.75" },
      ],
    );

    expect(merged.rows.map((r) => r.label)).toEqual(["Lawyer", "Plants and Soil", "Net Operating Income"]);
    expect(merged.rows[2].values).toEqual(["-300.00", ""]);
  });

  it("falls back to label as the key when id is empty", () => {
    const merged = mergeStatementMonths([
      {
        period: "2026-01",
        rows: [{ kind: "data", group: "", depth: 1, id: "", label: "Sales", value: "100.00" }],
      },
      {
        period: "2026-02",
        rows: [{ kind: "data", group: "", depth: 1, id: "", label: "Sales", value: "200.00" }],
      },
    ]);

    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0].values).toEqual(["100.00", "200.00"]);
  });
});
