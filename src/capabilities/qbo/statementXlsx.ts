/**
 * Deterministic QBO statement Excel (.xlsx) builder (Profit & Loss / Balance
 * Sheet) — the Excel counterpart to `buildQboStatementHtml`.
 *
 * Given the same flattened rows (sections, line items, subtotal/summary rows
 * with nesting depth), produces a formatted workbook laid out like a native QBO
 * statement: a metadata band (title, company, period, basis, currency, and the
 * Deterministic provenance note), bold section headers, indented line items,
 * and ruled subtotal/summary rows. Amounts are written as real numeric cells
 * with a currency number format — no LLM, a pure function of the inputs.
 *
 * Uses `exceljs` (rather than the read-side `xlsx` library) because it writes
 * cell styling — bold sections, fills, and subtotal rules — that the community
 * `xlsx` package cannot emit.
 */

import ExcelJS from "exceljs";
import { sanitizeSheetName } from "@shared/wfp-api/xlsx";
import type { QboStatementInput } from "./statementReport";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
};

/** Excel number format for a currency amount (negatives shown in red). */
function moneyFormat(currency: string): string {
  const sym = CURRENCY_SYMBOLS[String(currency ?? "").toUpperCase()];
  if (sym) return `${sym}#,##0.00;[Red](${sym}#,##0.00)`;
  return "#,##0.00;[Red](#,##0.00)";
}

/** Parse a QBO money string ("1,234.56") into a number, or null when empty. */
function toNumber(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A tabular projection of the statement for an inline read-only grid preview. */
export interface StatementGrid {
  columns: string[];
  rows: (string | number)[][];
  total: number;
}

/** Flatten the statement into a `columns` + `rows` grid for inline preview. */
export function statementPreview(input: QboStatementInput): StatementGrid {
  const amountCols = input.columns.length > 0 ? input.columns : ["Amount"];
  const columns = ["Account", ...amountCols];
  const rows = input.rows.map((r) => {
    if (r.kind === "section") return [r.label, ...amountCols.map(() => "")] as (string | number)[];
    return [
      "  ".repeat(r.depth) + r.label,
      ...amountCols.map((_, i) => {
        const n = toNumber(r.values[i]);
        return n !== null ? n : (r.values[i] ?? "");
      }),
    ] as (string | number)[];
  });
  return { columns, rows, total: rows.length };
}

/** Build a formatted single-sheet workbook from a QBO statement. */
export async function buildQboStatementWorkbook(input: QboStatementInput): Promise<Buffer> {
  const { workspace, company, title, period, currency, accountingMethod, columns, rows, note } =
    input;

  const amountCols = columns.length > 0 ? columns : ["Amount"];
  const colCount = 1 + amountCols.length;
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const fmt = moneyFormat(currency);

  const wb = new ExcelJS.Workbook();
  wb.creator = "WorkflowPeople";
  const ws = wb.addWorksheet(sanitizeSheetName(title));

  let r = 1;
  const setMeta = (text: string) => {
    ws.getCell(r, 1).value = text;
    r++;
  };

  const titleCell = ws.getCell(r, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  r++;

  if (company) setMeta(`Company: ${company}`);
  setMeta(`Period: ${period || "—"}`);
  setMeta(`Basis: ${accountingMethod}`);
  setMeta(`Currency: ${currency || "—"}`);
  setMeta(`Generated: ${when}`);
  if (workspace) setMeta(`Workspace: ${workspace}`);
  setMeta("Deterministic — all figures fetched from QuickBooks Online; no AI used to produce the numbers.");
  r++; // blank spacer

  // ── column header ──
  const headerRow = r;
  ws.getCell(headerRow, 1).value = "Account";
  amountCols.forEach((c, i) => {
    ws.getCell(headerRow, 2 + i).value = c;
  });
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(headerRow, c).font = { bold: true };
  }
  r++;

  // ── body ──
  for (const row of rows) {
    if (row.kind === "section") {
      const cell = ws.getCell(r, 1);
      cell.value = row.label;
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
      if (colCount > 1) ws.mergeCells(r, 1, r, colCount);
    } else {
      ws.getCell(r, 1).value = "  ".repeat(row.depth) + row.label;
      amountCols.forEach((_, i) => {
        const raw = row.values[i];
        const n = toNumber(raw);
        const cell = ws.getCell(r, 2 + i);
        if (n !== null) {
          cell.value = n;
          cell.numFmt = fmt;
          cell.alignment = { horizontal: "right" };
        } else {
          cell.value = raw ?? "";
        }
      });
      if (row.kind === "summary") {
        for (let c = 1; c <= colCount; c++) {
          const cell = ws.getCell(r, c);
          cell.font = { bold: true };
          cell.border = { top: { style: "thin" } };
        }
      }
    }
    r++;
  }

  if (note) {
    r++;
    ws.getCell(r, 1).value = note;
  }

  // ── column widths ──
  ws.getColumn(1).width = 44;
  for (let i = 0; i < amountCols.length; i++) {
    ws.getColumn(2 + i).width = 16;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
