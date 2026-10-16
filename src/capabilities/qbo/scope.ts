import {
  QBOClient,
  checkQBOConnected,
  clearQboTokens,
  getQboTokens,
  resolveQboScope,
  type QBOAccount,
  type QBOVendor,
  type QBOCustomer,
  type QBOClass,
  type QBODepartment,
  type QBOBill,
  type QBOInvoice,
  type QBOJournalEntry,
  type QBOJournalEntryInput,
} from "@capabilities/qbo/client";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { buildQboStatementHtml, mergeStatementMonths, type QboStatementRow, type StatementMonthRow } from "@capabilities/qbo/statementReport";
import { saveDataEntry } from "@data";

let currentScope: string | null = null;
let currentDatabaseId: string | null = null;

export function setScope(databaseId: string) {
  currentScope = resolveQboScope(databaseId);
  currentDatabaseId = databaseId;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export function requireScope(): string {
  if (!currentScope) throw new Error("QBO workspace scope not set");
  return currentScope;
}

/** Standard "not connected" payload — lets every tool surface the OAuth link
 *  directly instead of requiring a separate qbo_connect call first. */
export function notConnected() {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        connected: false,
        oauthUrl: "/auth/qbo",
        link: "[Authorize QuickBooks Online](/auth/qbo)",
        instructions: "The user must authorize QBO by opening the OAuth link. Use show_message to display a clickable link to the user.",
      }),
    }],
  };
}

/** Flatten a QBO report (Header/Columns/Rows) into columns + labeled rows. */
export function formatReportRows(report: any): {
  columns: string[];
  rows: Array<{ kind: string; group: string; depth: number; id: string; label: string; values: Array<{ column: string; value: string }> }>;
} {
  const header = report?.Header ?? {};
  const colDefs: any[] = report?.Columns?.Column ?? header.ColData ?? [];
  const columns: string[] = colDefs.map((c: any) => c?.ColTitle ?? c?.value ?? c?.id ?? "");

  const colValues = (colData: any[]): string[] =>
    (colData || []).map((c: any) => c?.value ?? "");

  const rows: Array<{ kind: string; group: string; depth: number; id: string; label: string; values: Array<{ column: string; value: string }> }> = [];

  const walk = (list: any[] | undefined, depth: number) => {
    for (const row of list ?? []) {
      let colData: any[] | null = null;
      let kind = "data";
      if (row.Header?.ColData) { colData = row.Header.ColData; kind = "section"; }
      else if (row.Summary?.ColData) { colData = row.Summary.ColData; kind = "summary"; }
      else if (row.ColData) { colData = row.ColData; kind = "data"; }

      if (colData) {
        const cells = colValues(colData);
        const label = cells[0] ?? "";
        const id = colData[0]?.id ?? "";
        const values = columns.slice(1).map((col, i) => ({
          column: col || `column_${i + 1}`,
          value: cells[i + 1] ?? "",
        }));
        rows.push({ kind, group: row?.group ?? "", depth, id, label, values });
      }

      walk(row?.Rows?.Row, kind === "section" ? depth + 1 : depth);
    }
  };

  walk(report?.Rows?.Row, 0);

  return { columns, rows };
}

export interface PnlFlatItem {
  qboName: string;
  qboId: string;
  group: string;
  period: string;
  amount: number;
}

export const toNum = (s?: string) => {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Flatten a normalized statement (amount columns + rows) into a tabular JSON
 *  array of row objects. Single-column statements use an `amount` key; multi-
 *  column statements use one key per column. Amounts are numeric so the table
 *  is directly consumable by aggregate_data / report_table / save_data. */
export function statementRowsToTable(
  columns: string[],
  rows: QboStatementRow[],
): Record<string, unknown>[] {
  const single = columns.length <= 1;
  const valueKeys = single
    ? ["amount"]
    : columns.map((c, i) => (c ? c : `column_${i + 1}`));
  return rows.map((r) => {
    const row: Record<string, unknown> = {
      label: r.label,
      kind: r.kind,
      depth: r.depth,
    };
    for (let i = 0; i < valueKeys.length; i++) {
      const raw = r.values[i] ?? "";
      row[valueKeys[i]] = raw === "" ? null : toNum(raw);
    }
    return row;
  });
}

/** Persist a normalized statement table into the workspace data map (with the
 *  same sanitization + privacy masking as save_data / api.setData). Returns the
 *  sanitized name the entry was stored under, or null when there is no active
 *  workspace scope. */
export function saveStatementTable(
  name: string,
  columns: string[],
  rows: QboStatementRow[],
): string | null {
  const db = getDatabaseId();
  if (!db) return null;
  const table = statementRowsToTable(columns, rows);
  const { name: stored } = saveDataEntry(db, name, {
    _meta: { type: "json_array" },
    data: table,
  });
  return stored;
}

/** Persist a raw QBO report (Header/Columns/Rows) as a structured table. */
export function saveReportTable(name: string, report: any): string | null {
  const { columns, rows } = formatReportRows(report);
  return saveStatementTable(
    name,
    columns.slice(1),
    rows.map((r) => ({
      kind: r.kind as "section" | "summary" | "data",
      label: r.label,
      depth: r.depth,
      values: r.values.map((v) => v.value),
    })),
  );
}

/** Expand a calendar date range into month boundaries: [{ period, start, end }]. */
export function monthRange(startDate: string, endDate: string): { period: string; start: string; end: string }[] {
  const [sy, sm] = startDate.split("-").map(Number);
  const [ey, em] = endDate.split("-").map(Number);
  const out: { period: string; start: string; end: string }[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const period = `${y}-${String(m).padStart(2, "0")}`;
    const lastDay = new Date(y, m, 0).getDate();
    out.push({ period, start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, "0")}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** Flatten a single-period P&L report into account amounts for a known period. */
export function parsePnlSingleMonth(report: any, period: string): PnlFlatItem[] {
  const items: PnlFlatItem[] = [];
  const walk = (rows: any[] = [], group = "") => {
    for (const r of rows) {
      const g = r?.group ?? group;
      const colData: any[] = r?.ColData ?? [];
      const first = colData[0];
      if (r?.type === "Data" && first?.id) {
        items.push({
          qboName: first.value,
          qboId: first.id,
          group: g,
          period,
          amount: toNum(colData[1]?.value),
        });
      }
      walk(r?.Rows?.Row, g);
    }
  };
  walk(report?.Rows?.Row);
  return items;
}

/** Fetch a report, falling back to a single "Total" column on grouping rejection. */
export async function fetchReportWithFallback(
  client: QBOClient,
  kind: "pnl" | "balance",
  startDate: string,
  endDate: string,
  requestedColumnBy: string,
  accountingMethod: string,
): Promise<{ report: any; columnBy: string; note: string | null }> {
  const call = (columnBy: string) =>
    kind === "pnl"
      ? client.profitAndLoss(startDate, endDate, { summarizeColumnBy: columnBy, accountingMethod })
      : client.balanceSheet(startDate, endDate, { summarizeColumnBy: columnBy, accountingMethod });

  try {
    return { report: await call(requestedColumnBy), columnBy: requestedColumnBy, note: null };
  } catch (err: any) {
    if (requestedColumnBy !== "Total") {
      return {
        report: await call("Total"),
        columnBy: "Total",
        note: `The "${requestedColumnBy}" column grouping is not supported for this QBO company (${err.message}). Showing a single total column instead.`,
      };
    }
    throw err;
  }
}

/** Workspace/company context for a statement's Report Context band. */
export function workspaceContext(): { workspace: string; company: string | null } {
  const workspace =
    (currentDatabaseId ? getSessionByDatabaseId(currentDatabaseId)?.getMetadata()?.workspace : null) ??
    "Workspace";
  const company = currentScope ? (getQboTokens(currentScope)?.company_name ?? null) : null;
  return { workspace, company };
}

/** Render a normalized statement (columns + rows) into a self-contained HTML statement. */
export function renderStatementHtml(input: {
  title: string;
  method: string;
  currency: string;
  period: string;
  columns: string[];
  rows: QboStatementRow[];
  note: string | null;
}): string {
  const { workspace, company } = workspaceContext();
  return buildQboStatementHtml({
    workspace,
    company,
    title: input.title,
    period: input.period,
    currency: input.currency,
    accountingMethod: input.method,
    columns: input.columns,
    rows: input.rows,
    note: input.note,
  });
}

/** Render a single fetched QBO report into a self-contained HTML statement. */
export function statementHtml(
  report: any,
  title: string,
  accountingMethod: string,
  note: string | null,
): string {
  const header = report?.Header ?? {};
  const { columns, rows } = formatReportRows(report);

  const startPeriod = header.StartPeriod ?? "";
  const endPeriod = header.EndPeriod ?? "";
  const period =
    startPeriod && endPeriod && startPeriod !== endPeriod
      ? `${startPeriod} – ${endPeriod}`
      : endPeriod || startPeriod;

  return renderStatementHtml({
    title,
    method: accountingMethod,
    currency: header.Currency ?? "",
    period,
    columns: columns.slice(1),
    rows: rows.map((r) => ({
      kind: r.kind as "section" | "summary" | "data",
      label: r.label,
      depth: r.depth,
      values: r.values.map((v) => v.value),
    })),
    note,
  });
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-01" → "Jan 2026". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Convert flattened report rows into the uniform shape the month merger expects. */
function toMonthRows(rows: ReturnType<typeof formatReportRows>["rows"]): StatementMonthRow[] {
  return rows.map((r) => ({
    kind: r.kind as "section" | "summary" | "data",
    group: r.group,
    depth: r.depth,
    id: r.id,
    label: r.label,
    value: r.values[0]?.value ?? "",
  }));
}

/** Fetch a single-month P&L per month and merge the rows into a multi-column matrix. */
export async function monthlyPnl(
  client: QBOClient,
  startDate: string,
  endDate: string,
  method: string,
): Promise<{ columns: string[]; rows: QboStatementRow[]; currency: string }> {
  const months = monthRange(startDate, endDate);

  const perMonth: { period: string; rows: StatementMonthRow[] }[] = [];
  let currency = "";

  for (const m of months) {
    const report = await client.profitAndLoss(m.start, m.end, {
      summarizeColumnBy: "Total",
      accountingMethod: method,
    });
    currency = currency || (report?.Header?.Currency ?? "");
    perMonth.push({ period: m.period, rows: toMonthRows(formatReportRows(report).rows) });
  }

  // Whole-period total, precomputed by QBO — merged in as the right column.
  const totalReport = await client.profitAndLoss(startDate, endDate, {
    summarizeColumnBy: "Total",
    accountingMethod: method,
  });
  currency = currency || (totalReport?.Header?.Currency ?? "");
  const totalRows = toMonthRows(formatReportRows(totalReport).rows);
  perMonth.push({ period: "Total", rows: totalRows });

  // Order rows by the full-period report's canonical account order; the per-month
  // reports each omit inactive accounts and end with summary rows, so "first
  // appearance" order would otherwise interleave sections and subtotals wrongly.
  const merged = mergeStatementMonths(perMonth, totalRows);
  const columns = merged.columns.map((c) => (c === "Total" ? "Total" : monthLabel(c)));
  return { columns, rows: merged.rows, currency };
}

export type {
  QBOAccount,
  QBOVendor,
  QBOCustomer,
  QBOClass,
  QBODepartment,
  QBOBill,
  QBOInvoice,
  QBOJournalEntry,
  QBOJournalEntryInput,
};
