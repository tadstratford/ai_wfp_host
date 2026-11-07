/**
 * Deterministic statement synthesis — turn a raw financial-statement grid into a
 * clean flat table. Pure functions, no LLM.
 *
 * Replaces the LLM structure-mapping in `synth.ts` for statement-style sheets,
 * which mis-slices them into transposed / fragmented tables (columns named by
 * values, sections split into separate tables). Two kinds are recognized:
 *
 *   - `trial_balance` — "Account | Debit | Credit" → { account, debit, credit }
 *   - `statement`     — "Account | Total(amount) | …" (Balance Sheet / P&L) →
 *                       { account, amount }
 *
 * Account rows (a leading 4-digit code) are kept; titles, section headers,
 * "Total" rows, and footers are dropped. Numbers are never transcribed by an LLM.
 */

export type StatementKind = "trial_balance" | "statement" | null;

export interface SynthTable {
  columns: string[];
  rows: string[][];
}

const CODE_RE = /\d{4}/g;

function cell(v: unknown): string {
  return String(v ?? "").trim();
}

function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    let t = v.trim();
    if (/^\(.*\)$/.test(t)) t = "-" + t.slice(1, -1);
    t = t.replace(/[,$%\s]/g, "");
    if (t === "" || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function accountCodes(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? "").match(CODE_RE) ?? []) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

function nonEmptyRows(grid: string[][]): string[][] {
  return grid.filter((r) => (r ?? []).some((c) => cell(c) !== ""));
}

/** Does this grid look like a statement/trial-balance sheet? */
export function detectStatementKind(grid: string[][]): StatementKind {
  const rows = nonEmptyRows(grid);

  // Trial balance: a header row with an "Account…" column and a "Debit"/"Credit"
  // column. Anchored so a ledger's "Distribution account" + "Vendor Credit"
  // transaction rows don't match.
  const hasTb = rows.some((r) => {
    const lower = r.map((c) => cell(c).toLowerCase());
    return (
      lower.some((c) => /^account\b/.test(c)) &&
      (lower.some((c) => /^debit$/.test(c)) || lower.some((c) => /^credit$/.test(c)))
    );
  });
  if (hasTb) return "trial_balance";

  // Statement: a "Total" (amount) column header plus account rows (leading code).
  const hasTotalHeader = rows.some((r) => r.some((c) => /^total$/i.test(cell(c))));
  const hasAccountRow = rows.some((r) => /^\d{4}\b/.test(cell(r[0] ?? "") ?? ""));
  if (hasTotalHeader && hasAccountRow) return "statement";

  return null;
}

function synthTrialBalance(grid: string[][]): SynthTable {
  const rows = nonEmptyRows(grid);
  let accountCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const a = r.findIndex((c) => /^account\b/i.test(cell(c)));
    const d = r.findIndex((c) => /^debit$/i.test(cell(c)));
    const cr = r.findIndex((c) => /^credit$/i.test(cell(c)));
    if (a >= 0 && (d >= 0 || cr >= 0)) {
      headerIdx = i;
      accountCol = a;
      debitCol = d;
      creditCol = cr;
      break;
    }
  }
  if (headerIdx < 0) return { columns: ["account", "debit", "credit"], rows: [] };

  const out: string[][] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const account = cell(r[accountCol] ?? "");
    if (!account) continue;
    if (/^(total|accrual|basis)/i.test(account)) continue;
    if (accountCodes(account).length === 0) continue; // section/footer without a code
    if (/^\d{1,2}:\d{2}\s*(am|pm)/i.test(account)) continue;
    const debit = debitCol >= 0 ? cell(r[debitCol] ?? "") : "";
    const credit = creditCol >= 0 ? cell(r[creditCol] ?? "") : "";
    out.push([account, debit, credit]);
  }
  return { columns: ["account", "debit", "credit"], rows: out };
}

function synthStatement(grid: string[][]): SynthTable {
  const rows = nonEmptyRows(grid);
  const colCount = Math.max(...rows.map((r) => r.length), 0);

  // Account column: the first column with a leading 4-digit code.
  let accountCol = -1;
  for (let c = 0; c < colCount; c++) {
    const hasCode = rows.some((r) => /^\d{4}\b/.test(cell(r[c] ?? "")));
    if (hasCode) {
      accountCol = c;
      break;
    }
  }
  if (accountCol < 0) return { columns: ["account", "amount"], rows: [] };

  // Amount column: the column with a "Total" header, else the non-account column
  // with the most numbers.
  let amountCol = -1;
  for (let c = 0; c < colCount; c++) {
    if (c === accountCol) continue;
    if (rows.some((r) => /^total$/i.test(cell(r[c] ?? "")))) {
      amountCol = c;
      break;
    }
  }
  if (amountCol < 0) {
    let best = 0;
    for (let c = 0; c < colCount; c++) {
      if (c === accountCol) continue;
      const n = rows.filter((r) => parseNumber(r[c]) !== null).length;
      if (n > best) {
        best = n;
        amountCol = c;
      }
    }
  }
  if (amountCol < 0) return { columns: ["account", "amount"], rows: [] };

  const out: string[][] = [];
  for (const r of rows) {
    const account = cell(r[accountCol] ?? "");
    if (!account) continue;
    if (/^total/i.test(account)) continue; // "Total X" rows are section sums, not accounts
    if (accountCodes(account).length === 0) continue; // section headers / titles
    const amount = cell(r[amountCol] ?? "");
    if (parseNumber(amount) === null) continue; // section headers have no amount
    out.push([account, amount]);
  }
  return { columns: ["account", "amount"], rows: out };
}

/** Deterministically synthesize a clean table from a statement-style grid, or
 *  null when the grid isn't a recognized statement/trial-balance layout. */
export function synthesizeStatement(grid: string[][]): SynthTable | null {
  const kind = detectStatementKind(grid);
  if (kind === "trial_balance") return synthTrialBalance(grid);
  if (kind === "statement") return synthStatement(grid);
  return null;
}
