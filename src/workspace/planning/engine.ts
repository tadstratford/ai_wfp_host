// Planning engine — deterministic, no LLM.
//
// Wide-format facts (FactRow[]) + reporting-account dimension (AccountDim[]).
// QBO account-by-month amounts roll up through the dimension into line-level
// facts. `null` = no data, `0` = a real zero. Amounts are natural sign
// (income +, expense +, balance +).

import type {
  AccountDim,
  FactRow,
  Per,
  QboSource,
  QboSourceRef,
} from "wfp-format";
import { perKey, PER_KEYS, UNMAPPED } from "wfp-format";

export interface QboMonthAmount {
  qboName: string;
  qboId?: string;
  period: string; // "YYYY-MM"
  amount: number;
}

const norm = (s: string) => s.trim().toLowerCase();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function emptyRow(fy: number, version: string, account: string): FactRow {
  const row: Record<string, unknown> = { "fiscal year": fy, version, account };
  for (const k of PER_KEYS) row[k] = null;
  return row as unknown as FactRow;
}

/** Normalize a dimension source (bare name or { name, id }) to its parts. */
function sourceParts(src: QboSource): QboSourceRef {
  return typeof src === "string" ? { name: src } : src;
}

/** Build id- and name-based lookup tables from the dimension's qboSources. */
function buildSourceIndex(dim: AccountDim[]) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const d of dim) {
    for (const src of d.qboSources) {
      const { name, id } = sourceParts(src);
      if (id) byId.set(String(id).trim(), d.account);
      if (name) byName.set(norm(name), d.account);
    }
  }
  return { byId, byName };
}

/** "YYYY-MM" → fiscal year + period number (1-based). Calendar year by default. */
export function fiscalPeriod(period: string, fyStartMonth = 1): { fy: number; per: number } {
  const [y, m] = period.split("-").map(Number);
  const per = ((m - fyStartMonth + 12) % 12) + 1;
  const fy = fyStartMonth === 1 ? y : m >= fyStartMonth ? y + 1 : y;
  return { fy, per };
}

export interface ToActualsResult {
  rows: FactRow[];
  unmapped: { qboName: string; qboId?: string; line: string }[];
}

/** Roll QBO account-by-month amounts into "actuals" fact rows via the dimension. */
export function qboToActualRows(
  items: QboMonthAmount[],
  dim: AccountDim[],
  fyStartMonth = 1,
): ToActualsResult {
  const { byId, byName } = buildSourceIndex(dim);
  const rows = new Map<string, FactRow>();
  const unmapped = new Map<string, { qboName: string; qboId?: string; line: string }>();

  for (const it of items) {
    let account: string | undefined;
    if (it.qboId) account = byId.get(String(it.qboId).trim());
    if (!account) account = byName.get(norm(it.qboName));
    if (!account) {
      account = UNMAPPED;
      const key = it.qboId ?? norm(it.qboName);
      if (!unmapped.has(key)) {
        unmapped.set(key, { qboName: it.qboName, qboId: it.qboId, line: UNMAPPED });
      }
    }
    const { fy, per } = fiscalPeriod(it.period, fyStartMonth);
    const key = `${fy}|${account}`;
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(fy, "actuals", account);
      rows.set(key, row);
    }
    const k = perKey(per);
    row[k] = round2((row[k] ?? 0) + it.amount);
  }

  return { rows: [...rows.values()], unmapped: [...unmapped.values()] };
}

/** Merge new rows into existing: non-null periods overwrite, everything else kept. */
export function mergeRows(existing: FactRow[], incoming: FactRow[]): FactRow[] {
  const key = (r: FactRow) => `${r["fiscal year"]}|${r.version}|${r.account}`;
  const out = new Map(existing.map((r) => [key(r), { ...r } as FactRow]));
  for (const inc of incoming) {
    const cur = out.get(key(inc));
    if (!cur) {
      out.set(key(inc), { ...inc });
      continue;
    }
    for (const k of PER_KEYS) {
      if (inc[k] !== null) cur[k] = inc[k];
    }
  }
  return [...out.values()];
}

const indexRows = (rows: FactRow[]) =>
  new Map(rows.map((r) => [`${r["fiscal year"]}|${r.version}|${r.account}`, r]));

/** Last period that has any non-null data for a version. 0 if none. */
export function lastPerWithData(rows: FactRow[], fy: number, version = "actuals"): number {
  let last = 0;
  for (const r of rows) {
    if (r["fiscal year"] !== fy || r.version !== version) continue;
    for (let n = 1; n <= 12; n++) if (r[perKey(n)] !== null && n > last) last = n;
  }
  return last;
}

/** Per-month base-vs-compare amounts for one account (drill-down detail). */
export interface MonthDetail {
  per: number;
  base: number | null;
  compare: number | null;
}

export function monthDetail(
  rows: FactRow[],
  fy: number,
  base: string,
  compare: string,
  account: string,
): MonthDetail[] {
  const idx = indexRows(rows);
  const b = idx.get(`${fy}|${base}|${account}`);
  const c = idx.get(`${fy}|${compare}|${account}`);
  return Array.from({ length: 12 }, (_, i) => ({
    per: i + 1,
    base: b?.[perKey(i + 1)] ?? null,
    compare: c?.[perKey(i + 1)] ?? null,
  }));
}

export interface BlendOpts {
  actuals?: string;
  forecast?: string;
  out?: string;
}

/** Latest estimate: actuals through cutoverPer, forecast after it (new version). */
export function blend(
  rows: FactRow[],
  fy: number,
  cutoverPer: number,
  opts: BlendOpts = {},
): FactRow[] {
  const { actuals = "actuals", forecast = "Forecast", out = "Latest estimate" } = opts;
  const idx = indexRows(rows);
  const accounts = new Set(
    rows.filter((r) => r["fiscal year"] === fy).map((r) => r.account),
  );
  return [...accounts].map((account) => {
    const a = idx.get(`${fy}|${actuals}|${account}`);
    const f = idx.get(`${fy}|${forecast}|${account}`);
    const row = emptyRow(fy, out, account);
    for (let n = 1; n <= 12; n++) {
      const k = perKey(n);
      row[k] = n <= cutoverPer ? a?.[k] ?? null : f?.[k] ?? null;
    }
    return row;
  });
}

export interface VarianceOpts {
  fy: number;
  base: string;      // usually "actuals"
  compare: string;   // "budget1", "budget2", "Forecast", ...
  fromPer?: number;  // default 1
  throughPer?: number; // default: last period with data in `base`
}

export interface VarianceRow {
  account: string;
  group?: string;
  kind: AccountDim["kind"];
  base: number;
  compare: number;
  variance: number;
  variancePct: number | null;
  favorable: boolean;
}

export function variance(rows: FactRow[], dim: AccountDim[], opts: VarianceOpts): VarianceRow[] {
  const { fy, base, compare } = opts;
  const from = opts.fromPer ?? 1;
  const through = opts.throughPer ?? lastPerWithData(rows, fy, base);
  const idx = indexRows(rows);

  const amount = (version: string, d: AccountDim): number => {
    const row = idx.get(`${fy}|${version}|${d.account}`);
    if (!row) return 0;
    if (d.kind === "balance") return row[perKey(through)] ?? 0;
    let s = 0;
    for (let n = from; n <= through; n++) s += row[perKey(n)] ?? 0;
    return s;
  };

  const make = (
    account: string,
    kind: AccountDim["kind"],
    b: number,
    c: number,
    group?: string,
  ): VarianceRow => {
    const v = round2(b - c);
    return {
      account,
      group,
      kind,
      base: round2(b),
      compare: round2(c),
      variance: v,
      variancePct: c === 0 ? null : round2((v / Math.abs(c)) * 100),
      favorable: kind === "expense" ? v <= 0 : v >= 0,
    };
  };

  const out = [...dim]
    .sort((a, b) => a.order - b.order)
    .map((d) => make(d.account, d.kind, amount(base, d), amount(compare, d), d.group));

  const net = (f: "base" | "compare") =>
    out.reduce(
      (s, r) => (r.kind === "income" ? s + r[f] : r.kind === "expense" ? s - r[f] : s),
      0,
    );
  out.push(make("Net Income", "income", net("base"), net("compare")));
  return out;
}
