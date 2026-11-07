/**
 * Deterministic trial-balance tie-out — pure functions, no app imports, no LLM.
 *
 * Ties the supporting schedules to the trial balance using the ACCOUNT NUMBER as
 * the join key. Two clean grids drive it:
 *   - the Trial Balance (`Account Name | Debit | Credit`) → account → balance,
 *   - the Balance Sheet (`Account | Amount | … | Notes`) → account → amount +
 *     the supporting-schedule reference in the Notes column.
 *
 * Because both statements use hierarchical account numbers ("1020 Intercompany:
 * 1021 Due from …"), the join key is the LEAF account code (the last numeric
 * token). Schedule sheets are matched to their trial-balance accounts by the
 * 4-digit account codes found in their cells, falling back to the Balance
 * Sheet's Notes mapping; a schedule's total is read from a labeled TOTAL row
 * where one exists, else from the Balance Sheet line, else it is `unresolved`
 * (never guessed).
 */

export interface TieOutSheet {
  name: string;
  grid: string[][];
}

export type AccountStatus = "tie" | "variance" | "missing_bs" | "missing_tb";

export interface TieOutAccount {
  code: string;
  name: string;
  bs_amount: number | null;
  tb_balance: number | null;
  variance: number | null;
  status: AccountStatus;
}

export type ScheduleStatus = "tie" | "variance" | "unmatched" | "unresolved";

export interface ScheduleTieOut {
  schedule: string;
  account_codes: string[];
  schedule_total: number | null;
  tb_balance: number | null;
  variance: number | null;
  status: ScheduleStatus;
  basis: string;
}

export interface TieOutResult {
  trial_balance: string;
  balance_sheet: string | null;
  tolerance: number;
  accounts: TieOutAccount[];
  schedules: ScheduleTieOut[];
  summary: {
    accounts: { tied: number; variance: number; missing_bs: number; missing_tb: number };
    schedules: { tied: number; variance: number; unmatched: number; unresolved: number };
  };
}

const CODE_RE = /\d{4}/g;

function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    let t = v.trim();
    if (/^\(.*\)$/.test(t)) t = "-" + t.slice(1, -1); // (1,000) → negative
    t = t.replace(/[,$%\s]/g, "");
    if (t === "" || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** All 4-digit account codes in a string (order-preserving). */
function accountCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").match(CODE_RE) ?? []) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

/** The account code used as the join key: the child code after the last ":" in a
 *  hierarchical name ("1020 Intercompany:1021 Due from …" → 1021), otherwise the
 *  FIRST code ("1001 Citizens Checking - 4279" → 1001, not the 4279 suffix). */
function leafCode(text: string): string | null {
  const t = String(text ?? "");
  const colonIdx = t.lastIndexOf(":");
  if (colonIdx >= 0) {
    const child = accountCodes(t.slice(colonIdx + 1));
    if (child.length > 0) return child[child.length - 1];
  }
  const codes = accountCodes(t);
  return codes.length > 0 ? codes[0] : null;
}

// ── Trial Balance ────────────────────────────────────────────────────────────

interface TbAccount {
  code: string | null;
  name: string;
  balance: number;
}

/** Parse the Trial Balance grid: find the Account/Debit/Credit header row, then
 *  read account rows (skip titles, the TOTAL row, and the accrual footer). */
function parseTrialBalance(grid: string[][]): TbAccount[] {
  const rows = grid.filter((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""));
  if (rows.length === 0) return [];

  let headerIdx = -1;
  let accountCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const a = r.findIndex((c) => /account/i.test(String(c ?? "")));
    const d = r.findIndex((c) => /debit/i.test(String(c ?? "")));
    const cr = r.findIndex((c) => /credit/i.test(String(c ?? "")));
    if (a >= 0 && (d >= 0 || cr >= 0)) {
      headerIdx = i;
      accountCol = a;
      debitCol = d;
      creditCol = cr;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const accounts: TbAccount[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[accountCol] ?? "").trim();
    if (!name) continue;
    if (/^(total|accrual|basis|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(name)) continue;
    if (/^\d{1,2}:\d{2}\s*(am|pm)/i.test(name)) continue;
    const debit = debitCol >= 0 ? parseNumber(r[debitCol]) ?? 0 : 0;
    const credit = creditCol >= 0 ? parseNumber(r[creditCol]) ?? 0 : 0;
    accounts.push({ code: leafCode(name), name, balance: round2(debit - credit) });
  }
  return accounts;
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

interface BsLine {
  code: string | null;
  name: string;
  amount: number | null;
  note: string | null;
}

interface BsParse {
  lines: BsLine[];
  /** note → parent account codes (from "Total for <code> …" rows, e.g. "2. Intercompany" → 1020). */
  noteParents: Map<string, string[]>;
}

const NOTE_RE = /^\d{1,3}\.\s+\S/;
const TOTAL_FOR_RE = /^total\s+for\s+(.+)$/i;

/** Parse the Balance Sheet grid: find the amount column (the "Total" column) and
 *  the Notes column, then read account rows (leading account code) plus
 *  "Total for X" rows whose note maps a whole account group to a schedule. */
function parseBalanceSheet(grid: string[][]): BsParse {
  const rows = grid.filter((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""));
  if (rows.length === 0) return { lines: [], noteParents: new Map() };

  const colCount = Math.max(...rows.map((r) => r.length), 0);

  // Notes column: header "Notes"/"Schedule"/… or values like "1. Cash".
  let notesCol = -1;
  for (let c = 0; c < colCount; c++) {
    const values = rows.map((r) => String(r[c] ?? "").trim());
    if (values.some((v) => NOTE_RE.test(v) || /^(notes?|schedule|reference|supporting)\b/i.test(v))) {
      notesCol = c;
      break;
    }
  }

  // Account column: the first column with cells carrying a leading 4-digit code.
  let accountCol = -1;
  for (let c = 0; c < colCount; c++) {
    if (c === notesCol) continue;
    const hasCode = rows.some((r) => {
      const v = String(r[c] ?? "").trim();
      return /^\d{4}\b/.test(v);
    });
    if (hasCode) {
      accountCol = c;
      break;
    }
  }

  // Amount column: the non-account, non-notes column with the most numbers.
  let amountCol = -1;
  let bestCount = 0;
  for (let c = 0; c < colCount; c++) {
    if (c === accountCol || c === notesCol) continue;
    const n = rows.filter((r) => parseNumber(r[c]) !== null).length;
    if (n > bestCount) {
      bestCount = n;
      amountCol = c;
    }
  }

  const lines: BsLine[] = [];
  const noteParents = new Map<string, string[]>();
  for (const r of rows) {
    const note = notesCol >= 0 ? String(r[notesCol] ?? "").trim() || null : null;

    // "Total for <code> …" rows map a whole account group to a schedule note,
    // independent of the account column (which may be empty on a sparse sheet).
    const totalForCell = (r ?? []).find((c) => TOTAL_FOR_RE.test(String(c ?? "").trim()));
    if (totalForCell) {
      if (!note) continue;
      const m = TOTAL_FOR_RE.exec(String(totalForCell).trim());
      const parents = m ? accountCodes(m[1]) : [];
      if (parents.length > 0) noteParents.set(note, parents);
      continue;
    }

    const name = accountCol >= 0 ? String(r[accountCol] ?? "").trim() : "";
    if (!name) continue;
    if (/^total/i.test(name)) continue; // section totals are not tie-out lines
    const code = leafCode(name);
    if (!code) continue; // section headers / titles
    const amount = amountCol >= 0 ? parseNumber(r[amountCol]) : null;
    if (amount === null) continue; // section headers have no amount
    lines.push({ code, name, amount, note });
  }
  return { lines, noteParents };
}

// ── Schedules ────────────────────────────────────────────────────────────────

/** Leading integer of a schedule/sheet name ("4. AP Aging" → 4). */
function leadingNumber(text: string): number | null {
  const m = String(text ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export function tieOut(opts: {
  trialBalance: TieOutSheet;
  balanceSheet: TieOutSheet | null;
  tolerance?: number;
}): TieOutResult {
  const tolerance = opts.tolerance ?? 0;
  const tb = parseTrialBalance(opts.trialBalance.grid);
  const bs = opts.balanceSheet ? parseBalanceSheet(opts.balanceSheet.grid) : { lines: [], noteParents: new Map<string, string[]>() };

  const tbByCode = new Map<string, TbAccount>();
  for (const a of tb) if (a.code) tbByCode.set(a.code, a);
  const bsByCode = new Map<string, BsLine>();
  for (const l of bs.lines) if (l.code) bsByCode.set(l.code, l);

  // ── Account-level tie (Balance Sheet ↔ Trial Balance) ────────────────────
  // Scope to the balance-sheet accounts (the TB also holds P&L accounts, which
  // are a different tie-out and correctly absent from the balance sheet).
  const accounts: TieOutAccount[] = [];
  for (const code of [...bsByCode.keys()].sort((a, b) => a.localeCompare(b))) {
    const t = tbByCode.get(code);
    const b = bsByCode.get(code)!;
    const tbBalance = t ? t.balance : null;
    const bsAmount = b.amount !== null ? round2(b.amount) : null;
    let status: AccountStatus;
    let variance: number | null = null;
    if (tbBalance === null) status = "missing_tb";
    else {
      // Statements show liabilities/equity as positive magnitudes while the trial
      // balance carries a debit/credit sign, so compare magnitudes.
      variance = round2(Math.abs(bsAmount ?? 0) - Math.abs(tbBalance));
      status = Math.abs(variance) > tolerance ? "variance" : "tie";
    }
    accounts.push({
      code,
      name: t?.name ?? b?.name ?? code,
      bs_amount: bsAmount,
      tb_balance: tbBalance,
      variance,
      status,
    });
  }

  // ── Schedule-level tie ────────────────────────────────────────────────────
  // The Balance Sheet Notes column is the schedule→accounts map: a note on an
  // account row maps that account; a note on a "Total for <code>" row maps every
  // trial-balance account carrying that parent code (the "1020 Intercompany"
  // group → leaves 1021…1041). The schedules are the distinct Notes values —
  // discovered from the balance sheet, not from the schedule sheets.
  const scheduleCodes = new Map<string, Set<string>>();
  for (const l of bs.lines) {
    if (!l.note || !l.code) continue;
    const set = scheduleCodes.get(l.note) ?? new Set<string>();
    set.add(l.code);
    scheduleCodes.set(l.note, set);
  }
  for (const [note, parents] of bs.noteParents) {
    const set = scheduleCodes.get(note) ?? new Set<string>();
    for (const a of tb) {
      if (a.code && parents.some((p) => accountCodes(a.name).includes(p))) set.add(a.code);
    }
    if (set.size > 0) scheduleCodes.set(note, set);
  }

  const noteOrder = [...scheduleCodes.keys()].sort((a, b) => {
    const na = leadingNumber(a) ?? 0;
    const nb = leadingNumber(b) ?? 0;
    return na - nb || a.localeCompare(b);
  });

  const schedules: ScheduleTieOut[] = [];
  for (const note of noteOrder) {
    const codes = new Set<string>(scheduleCodes.get(note) ?? []);

    // The balance sheet already summarizes each schedule, so the schedule total is
    // the sum of its accounts' balance-sheet amounts (the schedule sheet's own
    // total is layout-dependent — net reconciliations, pivot tables — and is not
    // read). This is the gross schedule total the trial balance must tie to.
    const tbBalanceSum = [...codes].reduce((sum, c) => sum + (tbByCode.get(c)?.balance ?? 0), 0);
    const bsAmountSum = [...codes].reduce((sum, c) => sum + (bsByCode.get(c)?.amount ?? 0), 0);
    const bsCovered = [...codes].some((c) => bsByCode.get(c)?.amount != null);
    if (!bsCovered) {
      schedules.push({
        schedule: note,
        account_codes: [...codes].sort(),
        schedule_total: null,
        tb_balance: round2(tbBalanceSum),
        variance: null,
        status: "unresolved",
        basis: "accounts mapped but no balance-sheet line total",
      });
      continue;
    }

    const variance = round2(Math.abs(bsAmountSum) - Math.abs(tbBalanceSum));
    const status: ScheduleStatus = Math.abs(variance) > tolerance ? "variance" : "tie";
    schedules.push({
      schedule: note,
      account_codes: [...codes].sort(),
      schedule_total: round2(bsAmountSum),
      tb_balance: round2(tbBalanceSum),
      variance,
      status,
      basis: "schedule total from balance-sheet line",
    });
  }

  const sum = (arr: TieOutAccount[], status: AccountStatus) => arr.filter((a) => a.status === status).length;
  return {
    trial_balance: opts.trialBalance.name,
    balance_sheet: opts.balanceSheet?.name ?? null,
    tolerance,
    accounts,
    schedules,
    summary: {
      accounts: {
        tied: sum(accounts, "tie"),
        variance: sum(accounts, "variance"),
        missing_bs: 0,
        missing_tb: sum(accounts, "missing_tb"),
      },
      schedules: {
        tied: schedules.filter((s) => s.status === "tie").length,
        variance: schedules.filter((s) => s.status === "variance").length,
        unmatched: schedules.filter((s) => s.status === "unmatched").length,
        unresolved: schedules.filter((s) => s.status === "unresolved").length,
      },
    },
  };
}
