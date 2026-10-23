/**
 * Planning forecast — deterministic cash-forecast math, no LLM.
 *
 * Given a month-end cash balance feed (`{ period, amount }`, natural sign) and a
 * cutover period, it projects the remaining months of the fiscal year and
 * produces three wide fact rows: `actuals` (balances through cutover), `Forecast`
 * (actual through cutover + projected after), and `Latest estimate` (the blend).
 * `null` = no data; `0` = a real zero.
 */

import { perKey, type FactRow } from "wfp-format";

export interface CashBalance {
  period: string; // "YYYY-MM"
  amount: number;
}

export type ForecastMethod = "hold" | "trend";

export interface ForecastMonth {
  per: number;
  actual: number | null;
  forecast: number | null;
  latest: number | null;
}

export interface CashForecast {
  account: string;
  fy: number;
  cutoverPer: number;
  method: ForecastMethod;
  actuals: FactRow;
  forecast: FactRow;
  latest: FactRow;
  months: ForecastMonth[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function emptyRow(fy: number, version: string, account: string): FactRow {
  const row: Record<string, unknown> = { "fiscal year": fy, version, account };
  for (let n = 1; n <= 12; n++) row[perKey(n)] = null;
  return row as unknown as FactRow;
}

/** Calendar-year month number for "YYYY-MM" within `fy`, else null. */
function monthOf(period: string, fy: number): number | null {
  const [y, m] = period.split("-").map(Number);
  if (y !== fy || !Number.isFinite(m) || m < 1 || m > 12) return null;
  return m;
}

/**
 * Project month-end cash for the rest of `fy`.
 *
 * - `cutoverPer` — the last period taken from actuals; projections start after it.
 * - `method` "hold" keeps the cutover balance flat; "trend" repeats the last
 *   month-over-month change.
 */
export function forecastCash(
  balances: CashBalance[],
  fy: number,
  cutoverPer: number,
  method: ForecastMethod = "hold",
  account = "Operating Cash",
): CashForecast {
  const byMonth = new Map<number, number>();
  for (const b of balances) {
    const m = monthOf(b.period, fy);
    if (m === null) continue;
    byMonth.set(m, round2(b.amount));
  }

  const cut = Math.min(Math.max(Math.trunc(cutoverPer), 0), 12);

  // Last known balance at (or before) the cutover, and the one before it for trend.
  let lastBal: number | null = null;
  let prevBal: number | null = null;
  for (let n = 1; n <= cut; n++) {
    const v = byMonth.get(n);
    if (v !== undefined) {
      prevBal = lastBal;
      lastBal = v;
    }
  }
  const delta = lastBal !== null && prevBal !== null ? lastBal - prevBal : 0;

  const actualAt = (n: number): number | null => (n <= cut ? byMonth.get(n) ?? null : null);
  const projectedAt = (n: number): number | null => {
    if (n <= cut) return byMonth.get(n) ?? null;
    if (lastBal === null) return null;
    if (method === "trend") return round2(lastBal + delta * (n - cut));
    return lastBal;
  };

  const actuals = emptyRow(fy, "actuals", account);
  const forecast = emptyRow(fy, "Forecast", account);
  const latest = emptyRow(fy, "Latest estimate", account);
  const months: ForecastMonth[] = [];

  for (let n = 1; n <= 12; n++) {
    const a = actualAt(n);
    const f = projectedAt(n);
    actuals[perKey(n)] = a;
    forecast[perKey(n)] = f;
    latest[perKey(n)] = n <= cut ? a : f;
    months.push({ per: n, actual: a, forecast: f, latest: latest[perKey(n)] });
  }

  return { account, fy, cutoverPer: cut, method, actuals, forecast, latest, months };
}
