/**
 * Deterministic QBO statement HTML builder (Profit & Loss / Balance Sheet).
 *
 * Given the flattened rows of a QuickBooks report (sections, line items, and
 * subtotal/summary rows with their nesting depth), produces a self-contained,
 * brand-styled HTML statement laid out like a native QBO report: bold section
 * headers, indented line items, and ruled subtotal/summary rows. No LLM — the
 * output is a pure function of the inputs, so it is reproducible at run time.
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

export interface QboStatementRow {
  kind: "section" | "summary" | "data";
  label: string;
  depth: number;
  values: string[]; // one per amount column
}

export interface QboStatementInput {
  workspace: string;
  company: string | null;
  title: string;
  period: string;
  currency: string;
  accountingMethod: string;
  columns: string[]; // amount column titles (excluding the label column)
  rows: QboStatementRow[];
  note: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
};

function symbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(raw: string, currency: string): string {
  const n = Number((raw ?? "").replace(/,/g, ""));
  if (raw === "" || !Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol(currency)}${body}`;
}

const STATEMENT_CSS = `
table.statement{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--wfp-line);border-radius:10px;overflow:hidden}
table.statement th{background:#fafafe;padding:9px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--wfp-muted);border-bottom:1px solid var(--wfp-line)}
table.statement td{padding:7px 12px;font-size:14px;border-bottom:1px solid var(--wfp-line)}
tr.sect td{font-weight:700;color:var(--wfp-ink);background:var(--wfp-brand-tint);text-transform:uppercase;font-size:12px;letter-spacing:.03em}
tr.sum td{font-weight:700;border-top:2px solid var(--wfp-ink)}
td.label{color:var(--wfp-ink)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
`;

export function buildQboStatementHtml(input: QboStatementInput): string {
  const {
    workspace, company, title, period, currency, accountingMethod, columns, rows, note,
  } = input;

  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const header = `<section class="report-context">
    <div class="eyebrow">${esc(workspace)}</div>
    <h1>${esc(title)}</h1>
    <div class="meta">
      <span><b>Generated:</b> ${esc(when)}</span>
      ${company ? `<span><b>Company:</b> ${esc(company)}</span>` : ""}
      <span><b>Period:</b> ${esc(period)}</span>
      <span><b>Basis:</b> ${esc(accountingMethod)}</span>
      <span><b>Currency:</b> ${esc(currency)}</span>
    </div>
    <div class="provenance"><span class="tag det">Deterministic</span><span>All figures were fetched from QuickBooks Online and rendered deterministically — no AI was used to produce the numbers in this report.</span></div>
  </section>`;

  const emptyBody = `<p style="color:var(--wfp-muted)">No data to display.</p>`;

  if (rows.length === 0) {
    return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}${STATEMENT_CSS}</style></head>
<body><div class="wfp-wrap">${header}${emptyBody}
<footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer></div></body></html>`;
  }

  const colSpan = 1 + columns.length;
  const headCells =
    `<th>${columns.length === 0 ? "Amount" : ""}</th>` +
    columns.map((c) => `<th class="num">${esc(c)}</th>`).join("");

  const rowsHtml = rows
    .map((r) => {
      if (r.kind === "section") {
        return `<tr class="sect"><td colspan="${colSpan}">${esc(r.label)}</td></tr>`;
      }
      const cls = r.kind === "summary" ? "sum" : "line";
      const indent = 8 + r.depth * 16;
      const cells = r.values
        .map((v, i) => {
          const col = columns[i] ?? `column_${i + 1}`;
          void col;
          return `<td class="num">${fmtMoney(v, currency)}</td>`;
        })
        .join("");
      return `<tr class="${cls}"><td class="label" style="padding-left:${indent}px">${esc(r.label)}</td>${cells}</tr>`;
    })
    .join("");

  const noteHtml = note
    ? `<p class="statement-note" style="margin:12px 0 0;color:var(--wfp-muted);font-size:13px">${esc(note)}</p>`
    : "";

  const footer = `<footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer>`;

  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${BRAND_CSS}${STATEMENT_CSS}</style></head>
<body><div class="wfp-wrap">${header}
<table class="statement"><thead><tr>${headCells}</tr></thead><tbody>${rowsHtml}</tbody></table>
${noteHtml}
${footer}</div></body></html>`;
}

export interface StatementMonthRow {
  kind: "section" | "summary" | "data";
  group: string;
  depth: number;
  id: string;
  label: string;
  value: string;
}

/** Merge per-month statement rows into a multi-column matrix, aligned by QBO
 *  row id (account/section id), falling back to label when id is empty. Rows
 *  keep the order they first appear; months without a value get an empty cell.
 *  When `orderSource` is provided, the rows are instead ordered by that source's
 *  key order (e.g. a full-period report listing every account in canonical
 *  order); any rows missing from the source are appended in first-appearance
 *  order. */
export function mergeStatementMonths(
  months: { period: string; rows: StatementMonthRow[] }[],
  orderSource?: StatementMonthRow[],
): { columns: string[]; rows: QboStatementRow[] } {
  const columns = months.map((m) => m.period);
  const n = months.length;
  const merged = new Map<string, QboStatementRow>();
  const firstSeen: string[] = [];

  for (let mi = 0; mi < n; mi++) {
    for (const row of months[mi].rows) {
      const key = row.id || row.label;
      let entry = merged.get(key);
      if (!entry) {
        entry = { kind: row.kind, label: row.label, depth: row.depth, values: new Array(n).fill("") };
        merged.set(key, entry);
        firstSeen.push(key);
      }
      entry.values[mi] = row.value;
    }
  }

  let order: string[];
  if (orderSource) {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of orderSource) {
      const key = r.id || r.label;
      if (merged.has(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
    for (const k of firstSeen) {
      if (!seen.has(k)) {
        seen.add(k);
        ordered.push(k);
      }
    }
    order = ordered;
  } else {
    order = firstSeen;
  }

  return { columns, rows: order.map((k) => merged.get(k)!) };
}
