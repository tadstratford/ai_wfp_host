/**
 * Deterministic cash-forecast HTML report builder.
 *
 * Given a cash account's month-by-month Actual vs Forecast vs "Latest estimate"
 * balances, produces a self-contained, brand-styled HTML report. No LLM — the
 * output is a pure function of the inputs, so it is reproducible at run time.
 */

import { BRAND_CSS } from "./report";

const CASH_CSS = `
table.cash{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--wfp-line);border-radius:10px;overflow:hidden}
table.cash th{background:#fafafe;padding:9px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--wfp-muted);border-bottom:1px solid var(--wfp-line)}
table.cash td{padding:8px 12px;font-size:14px;border-bottom:1px solid var(--wfp-line)}
tr.forecast td{background:#f7f8ff}
tr.cutover td{background:var(--wfp-brand-tint)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.mono{font-variant-numeric:tabular-nums;color:var(--wfp-muted)}
.tag{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;margin-left:8px}
.tag.actual{background:#ecfdf5;color:#047857}
.tag.forecast{background:#eef2ff;color:var(--wfp-brand)}
.band{margin-top:16px;background:#fff;border:1px solid var(--wfp-line);border-left:4px solid var(--wfp-brand);border-radius:10px;padding:14px 18px;display:flex;gap:32px;flex-wrap:wrap}
.band .cell .k{color:var(--wfp-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:2px}
.band .cell .v{font-size:20px;font-weight:600;color:var(--wfp-ink)}
`;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  const sign = n < 0 ? "-" : "";
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

export interface CashReportMonth {
  per: number;
  actual: number | null;
  forecast: number | null;
  latest: number | null;
}

export interface CashReportInput {
  workspace: string;
  title: string;
  meta: { fy: number; account: string; method: string; cutover: number };
  months: CashReportMonth[];
}

export function buildCashForecastReportHtml(input: CashReportInput): string {
  const { workspace, title, meta, months } = input;
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const header = `<section class="report-context">
    <div class="eyebrow">${esc(workspace)}</div>
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span><b>Generated:</b> ${esc(when)}</span>
      <span><b>Fiscal year:</b> ${esc(meta.fy)}</span>
      <span><b>Account:</b> ${esc(meta.account)}</span>
      <span><b>Method:</b> ${esc(meta.method)}</span>
      <span><b>Cutover:</b> P${esc(meta.cutover)}</span>
    </div>
    <div class="provenance"><span class="tag det">Deterministic</span><span>All figures were computed deterministically — no AI was used to produce the numbers in this report.</span></div>
  </section>`;

  if (months.length === 0) {
    return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}${CASH_CSS}</style></head>
<body><div class="wfp-wrap">${header}<p style="color:var(--wfp-muted)">No data to display.</p>
<footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer></div></body></html>`;
  }

  const rows = months
    .map((m) => {
      const isForecast = m.per > meta.cutover;
      const isCutover = m.per === meta.cutover;
      const cls = isCutover ? "cutover" : isForecast ? "forecast" : "";
      const tag = isForecast
        ? `<span class="tag forecast">Forecast</span>`
        : isCutover
          ? `<span class="tag actual">Cutover</span>`
          : `<span class="tag actual">Actual</span>`;
      return `<tr class="${cls}">
        <td>P${m.per} · ${MONTH_NAMES[m.per - 1]} ${meta.fy}${tag}</td>
        <td class="num">${fmtMoney(m.actual)}</td>
        <td class="num">${fmtMoney(m.forecast)}</td>
        <td class="num">${fmtMoney(m.latest)}</td>
      </tr>`;
    })
    .join("");

  const yearend = months[months.length - 1]?.latest ?? null;
  const forecastCount = months.filter((m) => m.per > meta.cutover).length;

  const band = `<section class="band">
    <div class="cell"><div class="k">Projected FY-end cash</div><div class="v">${fmtMoney(yearend)}</div></div>
    <div class="cell"><div class="k">Forecast months</div><div class="v">${forecastCount}</div></div>
  </section>`;

  const footer = `<footer class="wfp-foot">Actuals through P${meta.cutover}, forecast after. Frozen snapshot — re-run the workflow to regenerate.</footer>`;

  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${BRAND_CSS}${CASH_CSS}</style></head>
<body><div class="wfp-wrap">${header}
<table class="cash"><thead><tr><th>Period</th><th class="num">Actual</th><th class="num">Forecast</th><th class="num">Latest estimate</th></tr></thead><tbody>${rows}</tbody></table>
${band}
${footer}</div></body></html>`;
}
