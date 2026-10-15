---
name: report-authoring
description: Author self-contained HTML reports with drill-down tables, brand styling, provenance, and CSV download. Use when the user asks for a report, dashboard, or a downloadable file.
scope: chat+workflow
tags: [report, html, delivery, dashboard]
---

## Instructions

Reports are the workspace's auditable artifacts — bookkeepers and auditors open
them in a browser, hand them to clients, and archive them. Every report must be
self-contained, drillable, consistently styled, and honest about how it was
produced. Build one with `chat_download(data = <full HTML>, filename = "report.html")`.

### Deterministic drill-down reports (preferred for tabular data)

For a table report whose summary rows expand to their detail rows, do **not**
hand-write the HTML. Use the deterministic `report_table` tool — it renders the
brand styling, the provenance band, and the expand-to-details rows itself, and
its output can be saved as a workflow that recomputes on current data:

1. Build a summary with `aggregate_data` (or `get_data`) and persist it via
   `save_data(name="staging_<name>", value=<summary rows>, type="json_array")`.
2. `report_table(summary="staging_<name>", details="<source data name>",
   group_by=["<join column(s)>"], detail_columns=["<cols to show>"], title="...")`
   → returns the finished self-contained HTML.
3. `chat_download(data=<the HTML report_table returned>, filename="report.html")`.

`report_table` only needs the summary/detail data names and the join columns;
it computes the report deterministically (provenance "Deterministic" — no AI).

### QuickBooks statements (native format)

For a QuickBooks Profit & Loss or Balance Sheet, do **not** hand-write the
HTML — use the deterministic renderers, which reproduce QBO's native layout
(bold section headers, indented line items, ruled subtotals) and return
self-contained HTML:

1. `report_qbo_pnl(start_date, end_date, summarize_column_by?, accounting_method?)`
   for the income statement, or `report_qbo_bs(...)` for the balance sheet.
   Use `summarize_column_by: "Months"` for a month-by-month P&L — it renders
   per-month columns, assembling them from single-month fetches when the company
   rejects the Months grouping.
2. `chat_download(data=<the HTML it returned>, filename="report.html")`.

These are deterministic and workflow-reproducible, like `report_table`.

The recipe below (CSS + helpers) is for **bespoke** reports — dashboards, charts,
or layouts `report_table` can't express.

### The four rules

1. **Self-contained `<!DOCTYPE html>`.** No external CSS or fonts. Inline
   `<style>` in `<head>`, inline `<script>` at the end of `<body>`. At most one
   Chart.js CDN `<script>` is acceptable.
2. **Bake data in as JSON literals.** `const ROWS = ${JSON.stringify(rows)};`
   inside a `<script>`. No `fetch`, no XHR — the file works offline.
3. **Drill-down = pre-rendered hidden rows + a `toggle()` class flip.** Every
   aggregate row is followed immediately by a hidden detail row. No framework,
   no server roundtrip.
4. **Consistent styling.** Copy the brand-token CSS below verbatim. Escape all
   user text with `esc()` and format money with `fmt()`.

### Brand tokens (copy verbatim into every report's `<style>`)

```css
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
.num{text-align:right;font-variant-numeric:tabular-nums}
.ai-chip{display:inline-block;margin-left:6px;font-size:10px;font-weight:600;line-height:1;
  vertical-align:middle;padding:2px 5px;border-radius:4px;background:var(--wfp-brand-tint);
  color:var(--wfp-brand);text-transform:uppercase;letter-spacing:.03em}
.hidden{display:none}
footer.wfp-foot{margin-top:18px;padding-top:12px;border-top:1px solid var(--wfp-line);
  color:var(--wfp-muted);font-size:12px}
```

### Required helpers (define locally in every report)

```js
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(n){const v=Number(n)||0;const sign=v<0?'-$':'$';return sign+Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});}
function toggle(id){const r=document.getElementById('detail-'+id);const i=document.getElementById('icon-'+id);
  if(r.classList.contains('hidden')){r.classList.remove('hidden');i.style.transform='rotate(90deg)';}
  else{r.classList.add('hidden');i.style.transform='';}}
```

### Drill-down pattern

```js
// summary row + immediately-following hidden detail row
let html = '';
for (const cat of categories) {
  const id = cat.id;
  const chip = cat.aiCategorized ? ' <span class="ai-chip">AI</span>' : '';
  html += `<tr class="cat-row" onclick="toggle('${id}')">
    <td><span id="icon-${id}" class="toggle-icon">▶</span> ${esc(cat.name)}${chip} <span class="tx-count">(${cat.tx.length})</span></td>
    <td class="num">${fmt(cat.total)}</td></tr>`;
  html += `<tr id="detail-${id}" class="detail-row hidden"><td colspan="2">
    <table class="tx-table"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>${cat.tx.map(t=>`<tr><td>${t.date}</td><td>${esc(t.description)}</td><td class="num">${fmt(t.amount)}</td></tr>`).join('')}</tbody></table>
    </td></tr>`;
}
```

### Report header + provenance

Every report opens with a slim header band: workspace name (eyebrow), report
title, and a meta line (generated timestamp, source data names + row counts).
State how it was produced honestly: a value you computed (`+`, `-`, `SUM`, a
lookup) gets no marker; a value the model chose or classified gets an
`<span class="ai-chip">AI</span>`. If every figure is deterministic, say so.

### CSV download (no app links)

Bake the raw source rows into the page and download via a `Blob` — never a
`fetch` or a link back to the app:

```js
const SOURCES = ${JSON.stringify(sourcesMap)}; // { "<file name>": "<raw CSV text>" }
function downloadSource(name){const csv=SOURCES[name];if(csv==null)return;
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download=name.replace(/\.[^.]+$/,'')+'.csv';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
```

### Tie-out + snapshot disclaimer

The footer must state: row/file counts, any explicit exclusions, and the
snapshot note — "Reclassifying transactions in the workspace will not update
this file — re-run to regenerate." If aggregates don't add up to the sum of
their rows, say which row and why; never silently drop a difference.

## Tools needed
- `save_data` — persist the combined `staging_*` table before delivering a multi-source report
- `report_table` — deterministic drill-down HTML report from a summary + detail table
- `report_qbo_pnl` / `report_qbo_bs` — deterministic native-QBO-style P&L / Balance Sheet reports
- `report_plan_variance` — deterministic budget-vs-actual variance HTML report (pair with `chat_download`)
- `chat_download` — deliver the finished self-contained HTML report
- `get_data`, `list_data`, `aggregate_data` — read the workspace data the report is built from
- `set_param`, `get_param` — hold intermediate tables while building
- `show_message` — short progress/status notes only

## Rules
- When a report combines two or more source tables, persist the combined table as workspace data via `save_data` with a name starting with `staging_` (unprefixed) before delivering the report.
- Deliver reports as a self-contained HTML document via `chat_download(data = <full HTML>, filename = "report.html")`. Do not dump the report as plain markdown.
- To deliver a hand-written HTML report, either (a) pass the full HTML inline — `chat_download(data = <full HTML>, filename = "report.html")` — or (b) stage it first with `set_param(name = "<name>", value = <full HTML>, type = "text")` and then deliver it by name — `chat_download(param = "<name>", filename = "report.html", content_type = "html")`. Never use `chat_download(data = "{{result}}")` immediately after a `set_param` — `{{result}}` resolves to the set_param confirmation text ("Parameter … set as …"), not the HTML you stored.
- Copy the brand-token CSS block verbatim; escape user text with `esc()` and format money with `fmt()`.
