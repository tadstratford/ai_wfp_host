// Normalize a parsed QBO report into a flat CSV table (columns + string rows)
// for the Data path. A recognized QBO upload is parsed, flattened to one row
// per line/account, and stored as a workspace data entry (`*_qbo_*`).

import type { QboGeneralLedgerList, QboJournal, QboChartOfAccounts } from "wfp-format/qbo";
import type { QboReportKind } from "./recognize";
import { rowsToCsv } from "../stage";
import { parseGeneralLedgerList } from "./parseGeneralLedgerList";
import { parseJournal } from "./parseJournal";
import { parseChartOfAccounts } from "./parseChartOfAccounts";

/** Journal | General Ledger | Chart of Accounts parse results. */
export type QboReportObject = QboJournal | QboGeneralLedgerList | QboChartOfAccounts;

export interface QboTable {
  columns: string[];
  rows: string[][];
}

/** Parse a recognized report's cell map into its canonical columnar shape. */
export function parseQboReport(
  kind: QboReportKind,
  cells: Record<string, string>,
  sourceFilename = "",
): QboReportObject {
  if (kind === "general_ledger_list") return parseGeneralLedgerList(cells, sourceFilename);
  if (kind === "journal") return parseJournal(cells, sourceFilename);
  return parseChartOfAccounts(cells);
}

function num(v: number | undefined): string {
  return v == null ? "" : String(v);
}

function journalToTable(journal: QboJournal): QboTable {
  const columns = [
    "date", "account", "accountType", "name", "num", "lineNo",
    "debit", "credit", "amount", "memo", "vendor", "customer",
    "class", "location",
  ];
  const rows: string[][] = [];
  for (let i = 0; i < journal.lines.account.length; i++) {
    const h = journal.lines.headerIndex[i] ?? 0;
    rows.push([
      journal.headers.date[h] ?? "",
      journal.lines.account[i] ?? "",
      journal.lines.accountType[i] ?? "",
      journal.headers.name[h] ?? "",
      journal.headers.num[h] ?? "",
      num(journal.lines.lineNo[i]),
      num(journal.lines.debit[i]),
      num(journal.lines.credit[i]),
      num(journal.lines.amount[i]),
      journal.lines.memo[i] ?? "",
      journal.lines.vendor[i] ?? "",
      journal.lines.customer[i] ?? "",
      journal.lines.class[i] ?? "",
      journal.lines.location[i] ?? "",
    ]);
  }
  return { columns, rows };
}

function glToTable(gl: QboGeneralLedgerList): QboTable {
  const columns = [
    "date", "account", "parent", "accountType", "name", "description",
    "num", "txnId", "debit", "credit", "amount",
  ];
  const rows: string[][] = [];
  for (let i = 0; i < gl.lines.accountIndex.length; i++) {
    const a = gl.lines.accountIndex[i] ?? 0;
    rows.push([
      gl.lines.date[i] ?? "",
      gl.accounts.name[a] ?? "",
      gl.accounts.parent[a] ?? "",
      gl.accounts.accountType[a] ?? "",
      gl.lines.name[i] ?? "",
      gl.lines.description[i] ?? "",
      gl.lines.num[i] ?? "",
      gl.lines.txnId[i] ?? "",
      num(gl.lines.debit[i]),
      num(gl.lines.credit[i]),
      num(gl.lines.amount[i]),
    ]);
  }
  return { columns, rows };
}

function coaToTable(coa: QboChartOfAccounts): QboTable {
  const columns = ["name", "number", "type", "subType", "parent", "active"];
  const rows: string[][] = [];
  for (let i = 0; i < coa.accounts.name.length; i++) {
    rows.push([
      coa.accounts.name[i] ?? "",
      coa.accounts.number[i] ?? "",
      coa.accounts.type[i] ?? "",
      coa.accounts.subType[i] ?? "",
      coa.accounts.parent[i] ?? "",
      String(coa.accounts.active[i] ?? true),
    ]);
  }
  return { columns, rows };
}

/** Flatten a parsed report into a normalized table (one row per line/account). */
export function qboReportToTable(kind: QboReportKind, report: QboReportObject): QboTable {
  if (kind === "journal") return journalToTable(report as QboJournal);
  if (kind === "general_ledger_list") return glToTable(report as QboGeneralLedgerList);
  return coaToTable(report as QboChartOfAccounts);
}

/** CSV text for the normalized table (header row + one row per line/account). */
export function qboReportToCsv(kind: QboReportKind, report: QboReportObject): string {
  const { columns, rows } = qboReportToTable(kind, report);
  return rowsToCsv(columns, rows);
}

/** Stable data-entry suffix per report kind (`<name>_qbo_<gl|journal|coa>`). */
export function qboEntrySuffix(kind: QboReportKind): string {
  if (kind === "general_ledger_list") return "gl";
  if (kind === "journal") return "journal";
  return "coa";
}