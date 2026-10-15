/**
 * Deterministic budget-vs-actual variance HTML report builder.
 *
 * Given variance lines (account, base, compare, variance, favorable) plus their
 * per-month detail, produces a self-contained, brand-styled HTML report grouped
 * by Income / Expense / Balance with a Net Income summary. Each line expands to
 * reveal its month-by-month Actual vs Budget detail. No LLM — the output is a
 * pure function of the inputs, so it is reproducible at run time.
 */

const BRAND_CSS = `
:root{
  --wfp-brand:#534AB7; --wfp-brand-tint:#EEF2FF; --wfp-accent:#4f46e5;
  --wfp-ink:#1e1b4b; --wfp-muted:#6b7280; --wfp-line:#e5e7eb; --wfp-bg:#f8f9fc;
  --wfp-pos:#16a34a; --wfp-neg:#dc2626;
}
*{box-sizing:border-box}
body{margin:0;background:var(--wfp-bg);color:var(--wfp-ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wfp-wrap{max-width:1040px;margin:0 auto;padding:24px}
.report-context{background:#fff;border:1px solid var(--wfp-line);
  border-left:4px solid var(--wfp-brand);border-radius:10px;padding:16px 18px;margin-bottom:20px}
.report-context .eyebrow{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--wfp-brand);
  text-transform:uppercase;letter-spacing:.04em}
.report-context h1{margin:0 0 8px;font-size:20px;color:var(--wfp-ink)}
.report-context .meta{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--wfp-muted);font-size:13px}
.report-context .meta b{color:var(--wfp-ink);font-weight:600}
.provenance{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding-top:12px;
  border-top:1px dashed var(--wfp-line);font-size:13px;color:var(--wfp-muted)}
.provenance .tag{flex:none;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
  font-size:11px;padding:2px 8px;border-radius:999px}
.provenance .tag.det{background:#ecfdf5;color:#047857}
table.main{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--wfp-line);border-radius:10px;overflow:hidden}
table.main th{background:#fafafe;text-align:left;padding:10px 12px;font-size:12px;
  text-transform:uppercase;letter-spacing:.03em;color:var(--wfp-muted);border-bottom:1px solid var(--wfp-line)}
.cat-row{cursor:pointer;border-bottom:1px solid var(--wfp-line)}
.cat-row:hover{background:var(--wfp-brand-tint)}
.cat-row td{padding:10px 12px}
.toggle-icon{display:inline-block;transition:transform .12s ease;color:var(--wfp-brand);font-size:11px}
.detail-row td{background:#fafafe;padding:0 12px 8px 32px}
.tx-table{width:100%;border-collapse:collapse;margin:4px 0 8px}
.tx-table th,.tx-table td{padding:6px 8px;font-size:13px;border-bottom:1px solid var(--wfp-line)}
.tx-count{color:var(--wfp-muted);font-weight:400}
.num{text-align:right;font-variant-numeric:tabular-nums}
.hidden{display:none}
footer.wfp-foot{margin-top:18px;padding-top:12px;border-top:1px solid var(--wfp-line);
  color:var(--wfp-muted);font-size:12px}
`;

export interface PlanVarianceMonth {
  per: number;
  base: number | null;
  compare: number | null;
}

export interface PlanVarianceLine {
  account: string;
  group?: string;
  kind: "income" | "expense" | "balance";
  base: number;
  compare: number;
  variance: number;
  variancePct: number | null;
  favorable: boolean;
  months: PlanVarianceMonth[];
}

export interface PlanVarianceReportInput {
  workspace: string;
  title: string;
  meta: { fy: number; base: string; compare: string; from: number; through: number };
  lines: PlanVarianceLine[];
  netIncome: PlanVarianceLine;
}

const PLAN_CSS = `
table.statement{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--wfp-line);border-radius:10px;overflow:hidden}
table.statement th{background:#fafafe;padding:9px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--wfp-muted);border-bottom:1px solid var(--wfp-line)}
table.statement td{padding:7px 12px;font-size:14px;border-bottom:1px solid var(--wfp-line)}
tr.sect td{font-weight:700;color:var(--wfp-ink);background:var(--wfp-brand-tint);text-transform:uppercase;font-size:12px;letter-spacing:.03em}
tr.sum td{font-weight:700;border-top:2px solid var(--wfp-ink)}
td.fav{color:var(--wfp-pos)}
td.unfav{color:var(--wfp-neg)}
`;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "";
  const sign = n < 0 ? "-" : "";
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${body}`;
}

function fmtPct(n: number | null): string {
  if (n === null || n === undefined) return "";
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

const KIND_ORDER: ("income" | "expense" | "balance")[] = ["income", "expense", "balance"];
const KIND_LABELS: Record<"income" | "expense" | "balance", string> = {
  income: "Income",
  expense: "Expense",
  balance: "Balance",
};

export function buildPlanVarianceReportHtml(input: PlanVarianceReportInput): string {
  const { workspace, title, meta, lines, netIncome } = input;
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const header = `<section class="report-context">
    <div class="eyebrow">${esc(workspace)}</div>
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span><b>Generated:</b> ${esc(when)}</span>
      <span><b>Fiscal year:</b> ${esc(meta.fy)}</span>
      <span><b>Base:</b> ${esc(meta.base)}</span>
      <span><b>Compare:</b> ${esc(meta.compare)}</span>
      <span><b>Periods:</b> ${esc(meta.from)}–${esc(meta.through)}</span>
    </div>
    <div class="provenance"><span class="tag det">Deterministic</span><span>All figures were computed deterministically — no AI was used to produce the numbers in this report.</span></div>
  </section>`;

  if (lines.length === 0) {
    return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}${PLAN_CSS}</style></head>
<body><div class="wfp-wrap">${header}<p style="color:var(--wfp-muted)">No data to display.</p>
<footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer></div></body></html>`;
  }

  const colSpan = 5;
  const head = `<tr><th>Line</th><th class="num">Actual</th><th class="num">Budget</th><th class="num">Variance</th><th class="num">Variance %</th></tr>`;

  let i = 0;
  const body: string[] = [];
  for (const kind of KIND_ORDER) {
    const group = lines.filter((l) => l.kind === kind);
    if (group.length === 0) continue;
    body.push(`<tr class="sect"><td colspan="${colSpan}">${esc(KIND_LABELS[kind])}</td></tr>`);
    for (const line of group) {
      const id = `v${i++}`;
      const favCls = line.favorable ? "fav" : "unfav";
      const monthRows = line.months
        .map(
          (m) =>
            `<tr><td>P${m.per}</td><td class="num">${fmtMoney(m.base)}</td><td class="num">${fmtMoney(m.compare)}</td></tr>`,
        )
        .join("");
      body.push(
        `<tr class="cat-row" onclick="toggle('${id}')">
          <td><span id="icon-${id}" class="toggle-icon">&#9654;</span> ${esc(line.account)}</td>
          <td class="num">${fmtMoney(line.base)}</td>
          <td class="num">${fmtMoney(line.compare)}</td>
          <td class="num ${favCls}">${fmtMoney(line.variance)}</td>
          <td class="num ${favCls}">${fmtPct(line.variancePct)}</td>
        </tr>`,
        `<tr id="detail-${id}" class="detail-row hidden"><td colspan="${colSpan}">
          <table class="tx-table"><thead><tr><th>Period</th><th class="num">Actual</th><th class="num">Budget</th></tr></thead><tbody>${monthRows}</tbody></table>
        </td></tr>`,
      );
    }
  }

  const netCls = netIncome.favorable ? "fav" : "unfav";
  body.push(
    `<tr class="sum">
      <td>Net Income</td>
      <td class="num">${fmtMoney(netIncome.base)}</td>
      <td class="num">${fmtMoney(netIncome.compare)}</td>
      <td class="num ${netCls}">${fmtMoney(netIncome.variance)}</td>
      <td class="num ${netCls}">${fmtPct(netIncome.variancePct)}</td>
    </tr>`,
  );

  const footer = `<footer class="wfp-foot">${lines.length} reporting lines. Frozen snapshot — re-run the workflow to regenerate.</footer>`;
  const script = `<script>function toggle(id){var r=document.getElementById('detail-'+id);var i=document.getElementById('icon-'+id);if(r.classList.contains('hidden')){r.classList.remove('hidden');i.style.transform='rotate(90deg)';}else{r.classList.add('hidden');i.style.transform='';}}</script>`;

  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${BRAND_CSS}${PLAN_CSS}</style></head>
<body><div class="wfp-wrap">${header}
<table class="statement"><thead>${head}</thead><tbody>${body.join("")}</tbody></table>
${footer}</div>${script}</body></html>`;
}
