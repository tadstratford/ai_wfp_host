/**
 * Deterministic drill-down HTML report builder.
 *
 * Given a summary table (aggregate rows) and a detail table (the underlying
 * rows), produces a self-contained, brand-styled HTML report: each summary row
 * expands to reveal the detail rows whose `groupBy` columns match. No LLM — the
 * output is a pure function of the inputs, so it is reproducible at run time.
 */

export interface DrilldownReportInput {
  workspace: string;
  title: string;
  summaryRows: Record<string, unknown>[];
  detailRows: Record<string, unknown>[];
  groupBy: string[];
  detailColumns: string[];
  sources: string[];
  /** Optional provenance notes (e.g. a workspace rule that was applied). */
  notes?: string[];
}

export const BRAND_CSS = `
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
.provenance .rule-note{display:block;width:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--wfp-line)}
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

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellValue(v: unknown, isGroup: boolean): string {
  if (v === null || v === undefined) return "";
  if (!isGroup && typeof v === "number") return v.toLocaleString("en-US");
  return esc(v);
}

function isNumeric(v: unknown): boolean {
  return typeof v === "number";
}

/** Stable key for a row's groupBy values, used to join details to summary.
 *  Values are normalized to strings so a numeric detail cell (6110) matches an
 *  aggregate's string key ("6110"). */
function groupKeyOf(row: Record<string, unknown>, groupBy: string[]): string {
  return JSON.stringify(
    groupBy.map((c) => {
      const v = row[c];
      return v === null || v === undefined ? "" : String(v);
    }),
  );
}

export function buildDrilldownReportHtml(input: DrilldownReportInput): string {
  const { workspace, title, summaryRows, detailRows, groupBy, detailColumns, sources, notes } = input;

  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const sourceLine = sources.map((s) => esc(s)).join(", ") || "None";
  const notesLine = (notes ?? [])
    .filter((n) => n && n.trim().length > 0)
    .map((n) => `<span class="rule-note">${esc(n)}</span>`)
    .join("");

  const header = `<section class="report-context">
    <div class="eyebrow">${esc(workspace)}</div>
    <h1>${esc(title)}</h1>
    <div class="meta"><span><b>Generated:</b> ${esc(when)}</span><span><b>Sources:</b> ${sourceLine}</span></div>
    <div class="provenance"><span class="tag det">Deterministic</span><span>All figures were computed deterministically — no AI was used to produce the numbers in this report.</span>${notesLine}</div>
  </section>`;

  const emptyBody = `<p style="color:var(--wfp-muted)">No data to display.</p>`;

  if (summaryRows.length === 0) {
    return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}</style></head>
<body><div class="wfp-wrap">${header}${emptyBody}
<footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer></div></body></html>`;
  }

  const summaryColumns = Object.keys(summaryRows[0]);

  // Index detail rows by their groupBy tuple.
  const byKey = new Map<string, Record<string, unknown>[]>();
  for (const d of detailRows) {
    const k = groupKeyOf(d, groupBy);
    const list = byKey.get(k) ?? [];
    list.push(d);
    byKey.set(k, list);
  }

  const headCells = summaryColumns
    .map((c) => {
      const isGroup = groupBy.includes(c);
      const cls = isNumeric(summaryRows[0][c]) && !isGroup ? ' class="num"' : "";
      return `<th${cls}>${esc(c)}</th>`;
    })
    .join("");

  let i = 0;
  const rowsHtml = summaryRows
    .map((row) => {
      const id = `g${i++}`;
      const matching = byKey.get(groupKeyOf(row, groupBy)) ?? [];
      const cells = summaryColumns
        .map((c) => {
          const isGroup = groupBy.includes(c);
          const cls = isNumeric(row[c]) && !isGroup ? ' class="num"' : "";
          const content = cellValue(row[c], isGroup);
          return `<td${cls}>${isGroup ? `<span id="icon-${id}" class="toggle-icon">&#9654;</span> ${content} <span class="tx-count">(${matching.length})</span>` : content}</td>`;
        })
        .join("");

      const detailHead = detailColumns.map((c) => `<th>${esc(c)}</th>`).join("");
      const detailRowsHtml = matching
        .map((d) => {
          const tds = detailColumns
            .map((c) => {
              const cls = isNumeric(d[c]) && !groupBy.includes(c) ? ' class="num"' : "";
              return `<td${cls}>${cellValue(d[c], groupBy.includes(c))}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");

      return `<tr class="cat-row" onclick="toggle('${id}')">${cells}</tr>
<tr id="detail-${id}" class="detail-row hidden"><td colspan="${summaryColumns.length}">
<table class="tx-table"><thead><tr>${detailHead}</tr></thead><tbody>${detailRowsHtml}</tbody></table>
</td></tr>`;
    })
    .join("");

  const footer = `<footer class="wfp-foot">${summaryRows.length} summary rows, ${detailRows.length} detail rows. Frozen snapshot — re-run the workflow to regenerate.</footer>`;

  const script = `<script>function toggle(id){var r=document.getElementById('detail-'+id);var i=document.getElementById('icon-'+id);if(r.classList.contains('hidden')){r.classList.remove('hidden');i.style.transform='rotate(90deg)';}else{r.classList.add('hidden');i.style.transform='';}}</script>`;

  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${BRAND_CSS}</style></head>
<body><div class="wfp-wrap">${header}
<table class="main"><thead><tr>${headCells}</tr></thead><tbody>${rowsHtml}</tbody></table>
${footer}</div>${script}</body></html>`;
}
