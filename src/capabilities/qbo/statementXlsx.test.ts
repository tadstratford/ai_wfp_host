import { describe, it, expect } from "bun:test";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { buildQboStatementWorkbook, statementPreview } from "./statementXlsx";
import type { QboStatementInput } from "./statementReport";

function sample(overrides: Partial<QboStatementInput> = {}): QboStatementInput {
  return {
    workspace: "Acme",
    company: "Acme Corp",
    title: "Profit and Loss",
    period: "2026-01-01 – 2026-12-31",
    currency: "USD",
    accountingMethod: "Accrual",
    columns: ["Total"],
    rows: [
      { kind: "section", label: "Income", depth: 0, values: [] },
      { kind: "data", label: "Sales", depth: 1, values: ["41,200.00"] },
      { kind: "summary", label: "Total Income", depth: 0, values: ["41,200.00"] },
    ],
    note: null,
    ...overrides,
  };
}

function rowIndexOf(ws: any, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getCell(r, 1).value).includes(label)) return r;
  }
  return -1;
}

describe("buildQboStatementWorkbook", () => {
  it("writes a real .xlsx with the statement title as the sheet name", async () => {
    const buf = await buildQboStatementWorkbook(sample());
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Profit and Loss"]);
  });

  it("writes amounts as numeric cells with a currency number format", async () => {
    const buf = await buildQboStatementWorkbook(sample());
    const wb = XLSX.read(buf, { type: "buffer", cellNF: true });
    const ws = wb.Sheets["Profit and Loss"];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];

    const idx = aoa.findIndex((r) => String(r[0]).includes("Sales"));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(aoa[idx][1]).toBe(41200); // numeric, not "41,200.00"

    const addr = XLSX.utils.encode_cell({ r: idx, c: 1 });
    expect(String(ws[addr].z)).toContain("#,##0.00");
  });

  it("bolds and fills section rows and rules summary rows", async () => {
    const buf = await buildQboStatementWorkbook(sample());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet("Profit and Loss")!;

    const incomeRow = rowIndexOf(ws, "Income");
    const income = ws.getCell(incomeRow, 1);
    expect(income.font?.bold).toBe(true);
    expect(income.fill?.type).toBe("pattern");

    const totalRow = rowIndexOf(ws, "Total Income");
    const total = ws.getCell(totalRow, 1);
    expect(total.font?.bold).toBe(true);
    expect(total.border?.top?.style).toBe("thin");
  });

  it("merges section rows across the amount columns", async () => {
    const buf = await buildQboStatementWorkbook(sample());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Profit and Loss"];
    const merges = ws["!merges"] ?? [];
    expect(merges.length).toBe(1); // "Income" section row
  });

  it("handles an empty statement and a note without failing", async () => {
    const buf = await buildQboStatementWorkbook(
      sample({ rows: [], note: "The Months grouping was unsupported; showing a total." }),
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets["Profit and Loss"];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
    const flat = aoa.map((r) => r.map(String).join(" ")).join("\n");
    expect(flat).toContain("The Months grouping was unsupported");
  });

  it("indents line items by depth in the preview grid", () => {
    const grid = statementPreview(sample());
    const sales = grid.rows.find((r) => String(r[0]).includes("Sales"))!;
    expect(sales[0]).toBe("  Sales"); // depth 1 → two leading spaces
    expect(grid.columns).toEqual(["Account", "Total"]);
    expect(grid.total).toBe(3);
  });
});
