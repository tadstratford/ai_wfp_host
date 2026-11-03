/**
 * Deterministic trial-balance tie-out — pure functions, no app imports.
 *
 * Ties supporting schedules / sub-ledgers to a trial balance: for each schedule
 * the engine sums its amount column and compares that total against the matched
 * trial-balance account balance(s), producing a per-schedule `tie` / `variance`
 * / `unmatched` / `unresolved` verdict.
 *
 * Everything is resolved deterministically from column names + inferred types:
 *   - the trial balance's account column and debit/credit (or amount) columns,
 *   - each schedule's amount column (a bare-number column name marks a
 *     transposed/unresolved sheet — fail closed rather than sum garbage),
 *   - schedule → trial-balance account matching by account code (a run of digits
 *     in the schedule's data name) then by significant name tokens.
 *
 * Used by the `tie_out` MCP tool.
 */

export interface TieOutTable {
  name: string;
  columns: string[];
  columnTypes: Record<string, string> | null;
  rows: Record<string, unknown>[];
}

export type TieOutStatus = "tie" | "variance" | "unmatched" | "unresolved";

export interface ScheduleTieOut {
  schedule: string;
  status: TieOutStatus;
  /** Sum of the schedule's amount column (null when unresolved). */
  schedule_total: number | null;
  /** Trial-balance account(s) the schedule matched to (by code/name token). */
  tb_accounts: string[];
  /** Sum of the matched trial-balance accounts' balances. */
  tb_balance: number | null;
  /** schedule_total - tb_balance (null when either side is unresolved). */
  variance: number | null;
  /** Human-readable basis for the match (or the reason it is unresolved). */
  basis: string;
}

export interface TieOutResult {
  trial_balance: string;
  account_column: string | null;
  schedules: ScheduleTieOut[];
  summary: { tied: number; variance: number; unmatched: number; unresolved: number };
}

const AMOUNT_HINT = /amount|total|balance|debit|credit|fee|revenue|cost|principal|interest|value|price|gross|net|sum/i;
const RATIO_HINT = /%|percent|pct|share|ratio|proportion|rate\b/i;
const BARE_NUMBER = /^[-+]?\d[\d,]*(\.\d+)?$/;

/** Generic tokens that never identify an account from a table name. */
const GENERIC_TOKENS = new Set([
  "synth", "cp", "trial", "balance", "sheet", "as", "of", "sep", "oct", "nov", "dec",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "ytd", "part", "schedule",
  "the", "and", "for", "with", "other", "current", "liabilities", "assets", "accounts",
]);

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().replace(/[,$%]/g, "");
    if (t === "" || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isNumericColumn(name: string, types: Record<string, string> | null): boolean {
  if (RATIO_HINT.test(name)) return false;
  const t = types?.[name];
  if (typeof t === "string") return /number|integer|float|decimal|currency/i.test(t);
  return AMOUNT_HINT.test(name);
}

interface BalanceColumns {
  debit: string | null;
  credit: string | null;
  amount: string | null;
  /** True when the only numeric column is bare-number-named (a transposed sheet). */
  transposed: boolean;
}

function detectBalanceColumns(table: TieOutTable): BalanceColumns {
  const numeric = table.columns.filter((c) => isNumericColumn(c, table.columnTypes));
  const named = numeric.filter((c) => AMOUNT_HINT.test(c) && !BARE_NUMBER.test(c.trim()));
  const typed = numeric.filter((c) => !BARE_NUMBER.test(c.trim()));

  const debit = named.find((c) => /debit|dr\b/i.test(c)) ?? null;
  const credit = named.find((c) => /credit|cr\b/i.test(c)) ?? null;
  const amount = named[0] ?? typed[0] ?? numeric[0] ?? null;

  // A bare-number column name means the sheet header was a value, not a label —
  // the table is transposed and its "amount" is not a real amount column.
  const transposed = !!amount && BARE_NUMBER.test(amount.trim());

  return { debit, credit, amount: debit || credit ? null : amount, transposed };
}

function accountColumnOf(table: TieOutTable): string | null {
  const categorical = table.columns.filter(
    (c) => !isNumericColumn(c, table.columnTypes) && !BARE_NUMBER.test(c.trim()),
  );
  return (
    categorical.find((c) => /account|name|entity|code|ref|description/i.test(c)) ??
    categorical[0] ??
    null
  );
}

function accountCodes(name: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of name.match(/\d{3,5}/g) ?? []) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^synth_/, "")
    .replace(/^cp_/, "")
    .split(/[_\s]+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** Match a schedule to trial-balance accounts. Priority: the schedule's own
 *  account-column values (strongest), then account codes in the schedule name,
 *  then significant name tokens. Returns every matched TB account name plus a
 *  human-readable basis so the pairing is auditable. */
function matchTbAccounts(
  schedule: TieOutTable,
  tbRows: Record<string, unknown>[],
  accountCol: string | null,
): { accounts: string[]; basis: string } {
  if (!accountCol) return { accounts: [], basis: "trial balance has no account column" };
  const names = tbRows.map((r) => String(r[accountCol] ?? "").trim()).filter(Boolean);

  // 1) Account-column values in the schedule are the accounts it details.
  const schedAcctCol = accountColumnOf(schedule);
  if (schedAcctCol) {
    const values = schedule.rows.map((r) => String(r[schedAcctCol] ?? "").trim()).filter(Boolean);
    if (values.length > 0) {
      const valueCodes = [...new Set(values.flatMap(accountCodes))];
      if (valueCodes.length > 0) {
        const hits = names.filter((n) => valueCodes.some((c) => n.includes(c)));
        if (hits.length > 0) {
          return { accounts: hits, basis: `account code(s) ${valueCodes.join(", ")} in schedule` };
        }
      }
      const hits = names.filter(
        (n) => values.some((v) => n.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(n.toLowerCase())),
      );
      if (hits.length > 0) return { accounts: hits, basis: "account name(s) in schedule" };
    }
  }

  // 2) Account codes in the schedule's data name.
  const codes = accountCodes(schedule.name);
  if (codes.length > 0) {
    const hits = names.filter((n) => codes.some((c) => n.includes(c)));
    if (hits.length > 0) return { accounts: hits, basis: `account code(s) ${codes.join(", ")}` };
  }

  // 3) Significant name tokens.
  const tokens = significantTokens(schedule.name);
  if (tokens.length > 0) {
    const hits = names.filter((n) => tokens.some((t) => n.toLowerCase().includes(t)));
    if (hits.length > 0) return { accounts: hits, basis: `name token(s) ${tokens.join(", ")}` };
  }

  return { accounts: [], basis: "no account code or name token matched the trial balance" };
}

function totalOf(
  rows: Record<string, unknown>[],
  debit: string | null,
  credit: string | null,
  amount: string | null,
): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const d = debit ? toNumber(r[debit]) : null;
    const c = credit ? toNumber(r[credit]) : null;
    const a = amount ? toNumber(r[amount]) : null;
    if (d === null && c === null && a === null) continue;
    any = true;
    total += (d ?? 0) - (c ?? 0) + (a ?? 0);
  }
  return any ? total : null;
}

function tieOutOne(
  schedule: TieOutTable,
  tbRows: Record<string, unknown>[],
  accountCol: string | null,
  tbBalance: Map<string, number>,
  tolerance: number,
): ScheduleTieOut {
  const cols = detectBalanceColumns(schedule);
  if (cols.transposed) {
    return {
      schedule: schedule.name,
      status: "unresolved",
      schedule_total: null,
      tb_accounts: [],
      tb_balance: null,
      variance: null,
      basis: "transposed sheet (amount column is a value, not a label) — resolve its data shape first",
    };
  }

  const scheduleTotal = totalOf(schedule.rows, cols.debit, cols.credit, cols.amount);
  if (scheduleTotal === null) {
    return {
      schedule: schedule.name,
      status: "unresolved",
      schedule_total: null,
      tb_accounts: [],
      tb_balance: null,
      variance: null,
      basis: "no numeric amount column detected",
    };
  }

  const match = matchTbAccounts(schedule, tbRows, accountCol);
  if (match.accounts.length === 0) {
    return {
      schedule: schedule.name,
      status: "unmatched",
      schedule_total: scheduleTotal,
      tb_accounts: [],
      tb_balance: null,
      variance: null,
      basis: match.basis,
    };
  }

  const tbBalanceSum = match.accounts.reduce((s, a) => s + (tbBalance.get(a) ?? 0), 0);
  const variance = round2(scheduleTotal - tbBalanceSum);
  const status: TieOutStatus = Math.abs(variance) > tolerance ? "variance" : "tie";

  return {
    schedule: schedule.name,
    status,
    schedule_total: scheduleTotal,
    tb_accounts: match.accounts,
    tb_balance: tbBalanceSum,
    variance,
    basis: match.basis,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function tieOut(
  trialBalance: TieOutTable,
  schedules: TieOutTable[],
  tolerance = 0,
): TieOutResult {
  const accountCol = accountColumnOf(trialBalance);
  const tbCols = detectBalanceColumns(trialBalance);

  const tbBalance = new Map<string, number>();
  for (const r of trialBalance.rows) {
    const key = String(r[accountCol ?? ""] ?? "").trim();
    if (!key) continue;
    const bal = totalOf([r], tbCols.debit, tbCols.credit, tbCols.amount) ?? 0;
    tbBalance.set(key, (tbBalance.get(key) ?? 0) + bal);
  }

  const out = schedules.map((s) => tieOutOne(s, trialBalance.rows, accountCol, tbBalance, tolerance));

  const summary = {
    tied: out.filter((r) => r.status === "tie").length,
    variance: out.filter((r) => r.status === "variance").length,
    unmatched: out.filter((r) => r.status === "unmatched").length,
    unresolved: out.filter((r) => r.status === "unresolved").length,
  };

  return { trial_balance: trialBalance.name, account_column: accountCol, schedules: out, summary };
}
