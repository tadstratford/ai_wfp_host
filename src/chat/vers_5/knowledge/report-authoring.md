---
knowledge_name: report-authoring
description: HTML report authoring recipe — drill-down, Chart.js, brand tokens, provenance tracking
relevant_agents: [build-workflow, modify-workflow]
---

## Report Authoring — The Recipe

Every workflow tool that produces a report MUST follow this recipe. Reports are the workspace's auditable artifacts — bookkeepers and auditors will open them in a browser, hand them to clients, and archive them. They have to be self-contained, drillable, immutable as of generation time, **consistently styled**, and **honest about how they were produced**.

The report belongs to the *workspace*, not the tool vendor. It leads with the workspace (the client/company) name and the report title — like a normal financial statement — not with a product logo.

A reader should be able to glance at any report and know four things without scrolling: which workspace and period it covers, what data fed it, whether the numbers were calculated deterministically or with AI assistance, and that it is a frozen snapshot. The Report Context band (below) delivers all four.

### The four primitives

1. **Self-contained `<!DOCTYPE html>` document.** No external CSS, no external fonts. Inline `<style>` in `<head>`, inline `<script>` at end of `<body>`. Exactly one CDN script tag is acceptable for a charting library (Chart.js). Nothing else fetches at view time.
2. **Data baked into the page as JSON literals at generation time.** Use `${JSON.stringify(rows)}` inside a template literal so the rendered HTML contains `const ROWS = [{...}, ...];`. No XHR, no fetch — the file works offline.
3. **Drill-down = pre-rendered hidden sibling rows + a `toggle(id)` class flip.** Emit `<tr class="cat-row" onclick="toggle('${id}')">…</tr>` immediately followed by `<tr id="detail-${id}" class="detail-row hidden">…nested detail table…</tr>`. A 6-line `toggle()` function flips the `hidden` class. No framework, no server roundtrip.
4. **Style + context come from the runtime, not from guesswork.** Use the house color tokens (below) for every report, and populate the Report Context band from `api.getReportContext()` — never hand-type the workspace name, period, or source list.

### Intermediate table (audit trail)

When a report (or widget) is built from **two or more source data tables**, persist the combined/intermediate result as a new workspace data item named **`staging_…`** (the tool chooses the suffix, e.g. `staging_cash_flow`) *before* delivering the report. The name is a **hard-coded string literal** (e.g. `api.setData("staging_cash_flow", rows)`), **not** a `{{variable}}`. In a workflow, call `api.setData("staging_<name>", rows)`; in chat, `save_data("staging_<name>", value, type, columns)`. This keeps an auditable, reproducible intermediate so the final numbers can be tied back to the source tables. Single-source reports do not need a staging table.

### Report Context — the common context element

Every report opens with a standard **Report Context band** at the top of the page (a slim top bar above it holds only the Report Facts button). The band is the report's header: it leads with the workspace name, states the report title, and grounds the reader in how to trust it. Do not improvise these values — read them from the host:

```js
const ctx = (await api.getReportContext?.()) ?? {
  // Fallback for minimal runners that don't supply context. In the hosted
  // app getReportContext() is always present, so this branch won't run.
  workspace: 'Workspace', period: null, generatedAt: new Date().toISOString(),
  workflowName: '', workflowId: null, dataFiles: [],
  provenance: 'deterministic', llmModel: null, runByEmail: null, ownerEmail: null,
};
```

`getReportContext()` is **async** (resolving the run-by / owner emails needs a lookup) — always `await` it.

`ctx` shape:

| Field | Meaning |
|-------|---------|
| `workspace` | Workspace name (from the .wfp meta) |
| `period` | Period label (e.g. "April 2026") or `null` |
| `generatedAt` | ISO timestamp captured when context was read |
| `workflowName` / `workflowId` | The workflow that produced this report |
| `dataFiles` | `[{ name, rowCount, contentHash }]` — every data file in the workspace at run time. `contentHash` is the first 16 hex of the file's SHA-256, so a reader can prove which version of the data was used |
| `provenance` | `"deterministic"` or `"ai-assisted"` — set by the runtime: `"ai-assisted"` if **any** node in this run called the LLM, else `"deterministic"` |
| `llmModel` | The model name when `ai-assisted`, else `null` |
| `runByEmail` | Email of the user who ran the workflow, or `null` |
| `ownerEmail` | Email of the workspace owner, or `null` |

The band MUST surface: workspace, period, generated timestamp, workflow name, the source manifest (name + row count), and the **"How this was produced"** provenance line. Render it with the helper below so every report looks identical.

All of these are **baked into the report HTML as literals at generation time**. The report is a frozen, self-contained artifact — it must never fetch from or link back to the app (see the Report Facts popup below).

### Brand tokens (copy verbatim into every report's `<style>`)

```css
:root{
  --wfp-brand:#534AB7;        /* Workflow People purple */
  --wfp-brand-tint:#EEF2FF;   /* light fill */
  --wfp-accent:#4f46e5;       /* indigo-600 accent */
  --wfp-ink:#1e1b4b;          /* headings / dark text */
  --wfp-muted:#6b7280;        /* secondary text */
  --wfp-line:#e5e7eb;         /* borders / rules */
  --wfp-bg:#f8f9fc;           /* page background */
  --wfp-pos:#16a34a;          /* positive amounts */
  --wfp-neg:#dc2626;          /* negative amounts */
}
*{box-sizing:border-box}
body{margin:0;background:var(--wfp-bg);color:var(--wfp-ink);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wfp-wrap{max-width:1040px;margin:0 auto;padding:24px}
.report-topbar{display:flex;justify-content:flex-end;margin-bottom:12px}
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
.provenance .tag.ai{background:var(--wfp-brand-tint);color:var(--wfp-brand)}
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
.ai-chip{display:inline-block;margin-left:6px;font-size:10px;font-weight:600;line-height:1;
  vertical-align:middle;padding:2px 5px;border-radius:4px;background:var(--wfp-brand-tint);
  color:var(--wfp-brand);text-transform:uppercase;letter-spacing:.03em}
.hidden{display:none}
footer.wfp-foot{margin-top:18px;padding-top:12px;border-top:1px solid var(--wfp-line);
  color:var(--wfp-muted);font-size:12px}
```

### Required report shell

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${reportTitle}</title>
<style>/* … brand tokens block above, then any report-specific rules … */</style>
</head>
<body>
<div class="wfp-wrap">

  <!-- 1. Top bar — Report Facts button only, right-aligned. No vendor logo. -->
  <div class="report-topbar">
    <button type="button" class="facts-btn" onclick="showFacts()">Report Facts</button>
  </div>

  <!-- 2. Report Context band — the header (workspace name + title), built by
       reportContextBand(ctx, reportTitle) -->
  ${reportContextBand(ctx, reportTitle)}

  <!-- 2b. Report Facts popup (built by reportFactsModal(ctx, reportTitle)) -->
  ${reportFactsModal(ctx, reportTitle)}

  <!-- 3. Summary cards (KPI band, optional) -->
  <section class="summary-cards">…</section>

  <!-- 4. Main table with grouped rows + hidden detail rows -->
  <table class="main">…</table>

  <!-- 5. Footer: tie-out totals + exclusions + snapshot note -->
  <footer class="wfp-foot">${tieOut}</footer>

</div>
<script>
function toggle(id) {
  const row = document.getElementById('detail-' + id);
  const icon = document.getElementById('icon-' + id);
  if (row.classList.contains('hidden')) {
    row.classList.remove('hidden');
    icon.style.transform = 'rotate(90deg)';
  } else {
    row.classList.add('hidden');
    icon.style.transform = '';
  }
}
// Report Facts popup — pure class flip, no fetch.
function showFacts() { document.getElementById('facts-overlay').classList.remove('hidden'); }
function hideFacts() { document.getElementById('facts-overlay').classList.add('hidden'); }
</script>
</body>
</html>
```

### The context band helper (copy verbatim)

```js
function reportContextBand(ctx, title) {
  const when = new Date(ctx.generatedAt).toLocaleString('en-US',
    { dateStyle: 'medium', timeStyle: 'short' });
  const sources = (ctx.dataFiles || []).length
    ? ctx.dataFiles.map(f =>
        `${esc(f.name)}${f.rowCount != null ? ` (${f.rowCount} rows)` : ''}`).join(', ')
    : 'None';

  // Provenance line — the trust signal. Honest by construction: the runtime
  // flips ctx.provenance to "ai-assisted" if any step called the LLM.
  const ai = ctx.provenance === 'ai-assisted';
  const provLine = ai
    ? `Figures are computed deterministically; some values (flagged <span class="ai-chip">AI</span>) were produced with model assistance${ctx.llmModel ? ` (${esc(ctx.llmModel)})` : ''} — review advised.`
    : `All figures were computed deterministically — no AI was used to produce the numbers in this report.`;

  // Header leads with the workspace (client/company) name, then the report
  // title with the period folded in — like a normal financial statement.
  return `<section class="report-context">
    <div class="eyebrow">${esc(ctx.workspace)}</div>
    <h1>${esc(title)}${ctx.period ? ` — ${esc(ctx.period)}` : ''}</h1>
    <div class="meta">
      <span><b>Generated:</b> ${esc(when)}</span>
      ${ctx.workflowName ? `<span><b>Workflow:</b> ${esc(ctx.workflowName)}</span>` : ''}
      <span><b>Sources:</b> ${sources}</span>
    </div>
    <div class="provenance">
      <span class="tag ${ai ? 'ai' : 'det'}">${ai ? 'AI-assisted' : 'Deterministic'}</span>
      <span>${provLine}</span>
    </div>
  </section>`;
}
```

### Provenance — the trust contract

Trust comes from being precise about what a human can rely on:

- **Report level.** The band's badge (`Deterministic` green / `AI-assisted` purple) and one-line explanation come straight from `ctx.provenance`. The runtime sets it — you cannot over- or under-claim by accident.
- **Value level.** Most real reports are *mixed*: exact arithmetic plus an AI-suggested column (e.g. a category the model assigned). Flag exactly those values with an inline chip so deterministic numbers read as solid and model-suggested fields are visibly marked:

```js
// A model-suggested category cell — chip it. Pure totals get NO chip.
`<td>${esc(cat.name)} <span class="ai-chip">AI</span></td>`
```

Rule of thumb: a number you computed with `+`, `-`, `SUM`, a lookup, or a rule → **no chip**. A value a model chose, classified, or wrote → **chip it**. If the whole report is deterministic, there are no chips and the band says so.

### Report Facts popup (in-report, static, no app links)

The top bar carries a **Report Facts** button that opens a popup with the full provenance of the report. **This popup lives entirely inside the report HTML.** It is built once, at generation time; every value is a baked-in literal; it never fetches, and it has **no links back to the app**. The file works — and the popup works — when emailed to a client or opened from an archive years later.

It uses the same mechanic as drill-down: a hidden overlay `<div>` and a `showFacts()` / `hideFacts()` class flip (already in the shell `<script>`). The "download CSV" links do **not** call the app — they rebuild the file from data baked into the page via a `Blob`.

**CSS — append to the report's `<style>`:**

```css
.facts-btn{font-size:12px;font-weight:600;color:var(--wfp-brand);
  background:var(--wfp-brand-tint);border:1px solid var(--wfp-brand);border-radius:999px;
  padding:4px 12px;cursor:pointer}
.facts-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;
  justify-content:center;background:rgba(0,0,0,.5);padding:16px}
/* Must beat the bare .facts-overlay display:flex — equal-specificity .hidden
   loses by source order otherwise, leaving the popup stuck open. */
.facts-overlay.hidden{display:none}
.facts-card{background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.3);
  width:100%;max-width:460px;overflow:hidden}
.facts-head{display:flex;align-items:center;justify-content:space-between;
  padding:12px 18px;border-bottom:1px solid var(--wfp-line)}
.facts-head h2{margin:0;font-size:16px;color:var(--wfp-ink)}
.facts-close{background:none;border:none;font-size:22px;line-height:1;color:var(--wfp-muted);
  cursor:pointer;padding:0 4px}
.facts-body{padding:14px 18px}
.facts-row{display:flex;gap:12px;padding:5px 0;font-size:13px}
.facts-row .k{width:130px;flex:none;color:var(--wfp-muted)}
.facts-row .v{flex:1;color:var(--wfp-ink);word-break:break-word}
.facts-sep{border-top:1px dashed var(--wfp-line);margin:8px 0}
.facts-dl{color:var(--wfp-accent);text-decoration:none;font-weight:600;margin-left:6px;cursor:pointer}
.facts-muted{color:var(--wfp-muted);font-style:italic}
.facts-foot{padding:10px 18px;border-top:1px solid var(--wfp-line);
  font-size:12px;color:var(--wfp-muted)}
```

**Bake the source contents + the download helper into the page `<script>`** (so "download CSV" needs no network):

```js
// sourcesMap: { "<file name>": "<raw CSV text>" } — built by the tool from the
// data it loaded. Baked as a literal; never fetched.
const SOURCES = ${JSON.stringify(sourcesMap)};
function downloadSource(name) {
  const csv = SOURCES[name];
  if (csv == null) return;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name.replace(/\.[^.]+$/, '') + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```

**The popup helper (copy verbatim):**

```js
// ctx is api.getReportContext(); optionally attach ctx.knowledge (string[])
// and ctx.audit ({ passed: boolean } | { flagged: number }) before calling.
function reportFactsModal(ctx, title) {
  const when = new Date(ctx.generatedAt).toLocaleString('en-US',
    { dateStyle: 'long', timeStyle: 'short' });
  const ai = ctx.provenance === 'ai-assisted';
  const method = ai ? `AI-assisted${ctx.llmModel ? ` (${esc(ctx.llmModel)})` : ''}` : 'Deterministic';

  const sources = (ctx.dataFiles || []).length
    ? ctx.dataFiles.map(f =>
        `${esc(f.name)}<span class="facts-dl" onclick="downloadSource('${esc(f.name)}')">↓ CSV</span>`
      ).join('<br>')
    : '<span class="facts-muted">—</span>';

  const knowledge = (ctx.knowledge && ctx.knowledge.length)
    ? ctx.knowledge.map(esc).join(', ')
    : '<span class="facts-muted">Not recorded</span>';

  let audit = '<span class="facts-muted">Not available yet</span>';
  if (ctx.audit && typeof ctx.audit.flagged === 'number' && ctx.audit.flagged > 0)
    audit = `⚠ ${ctx.audit.flagged} flagged`;
  else if (ctx.audit && ctx.audit.passed) audit = '✓ Passed';

  const row = (k, v) => `<div class="facts-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const orDash = (v) => v ? esc(v) : '<span class="facts-muted">—</span>';

  return `<div id="facts-overlay" class="facts-overlay hidden" onclick="if(event.target===this)hideFacts()">
    <div class="facts-card">
      <div class="facts-head">
        <h2>Report Facts</h2>
        <button type="button" class="facts-close" aria-label="Close" onclick="hideFacts()">&times;</button>
      </div>
      <div class="facts-body">
        ${row('Report', esc(title))}
        ${row('Workflow', orDash(ctx.workflowName))}
        ${row('Workspace', orDash(ctx.workspace))}
        ${row('Generated', esc(when))}
        ${row('Method', method)}
        <div class="facts-sep"></div>
        ${row('Source data', sources)}
        ${row('Knowledge', knowledge)}
        ${row('Self-audit', audit)}
        <div class="facts-sep"></div>
        ${row('Run by', orDash(ctx.runByEmail))}
        ${row('Workspace owner', orDash(ctx.ownerEmail))}
      </div>
      <div class="facts-foot">Reflects workspace &amp; workflow as of generation time.</div>
    </div>
  </div>`;
}
```

Notes:
- **No app links.** Source downloads come from the baked-in `SOURCES` map via a `Blob` — never `/app/...`. If you don't have the raw CSV for a source, omit its `↓ CSV` link rather than pointing at the app.
- `runByEmail` / `ownerEmail` are resolved by the host in `getReportContext()` and baked in as literals.
- `knowledge` and `audit` are optional today — attach them to `ctx` if the workflow tracked them; otherwise the popup shows honest "Not recorded" / "Not available yet" placeholders. The **format** is fixed even when a value isn't.

### Drill-down pattern (every aggregate must expand)

```js
// For each category, emit one summary row + one hidden detail row
let html = '';
for (const cat of categories) {
  const id = cat.id;
  const aiChip = cat.aiCategorized ? ' <span class="ai-chip">AI</span>' : '';
  html += `<tr class="cat-row" onclick="toggle('${id}')">
    <td><span id="icon-${id}" class="toggle-icon">▶</span> ${esc(cat.name)}${aiChip} <span class="tx-count">(${cat.tx.length})</span></td>
    <td class="num">${fmt(cat.total)}</td>
  </tr>`;
  html += `<tr id="detail-${id}" class="detail-row hidden">
    <td colspan="2">
      <table class="tx-table">
        <thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${cat.tx.map(t => `<tr><td>${t.date}</td><td>${esc(t.description)}</td><td>${esc(t.account)}</td><td class="num">${fmt(t.amount)}</td></tr>`).join('')}
        </tbody>
      </table>
    </td>
  </tr>`;
}
```

Pre-render ALL detail rows. Hiding is a CSS-class flip. Do NOT fetch on click.

### Delivery contract

The tool sets the rendered HTML on a parameter consumed by the next node's download button:

```js
const html = `<!DOCTYPE html>…`; // built from the recipe above
api.setParameter('html_report', {
  _meta: { type: 'text', length: html.length },
  data: html
});
api.addMessage({ markdown: `✅ Report generated — ${nRows} rows, ${nTx} transactions. See the Download button below.` });
```

The workflow plan must follow this tool with a `chat_download` node:

```json
{ "label": "Download Report", "tool_id": "chat_download",
  "tool_parameters": { "data": "{{html_report}}", "filename": "report.html", "label": "Download Report" } }
```

### Workflow report delivery (no free-form LLM step)

A workflow has no free-form LLM step, so it cannot build a bespoke HTML report the way the chat path does. For **tabular** results with drill-down, build the HTML deterministically with the `report_table` tool, then deliver it:

```json
{ "label": "Build Report", "tool_id": "report_table",
  "tool_parameters": { "summary": "staging_ic_gl_summary", "details": "interco_audit_demo_ic_transactions", "group_by": ["GL Account"], "detail_columns": ["Txn ID", "Date", "Memo", "Amount (USD)"], "title": "Amount by GL Account" } },
{ "label": "Download Report", "tool_id": "chat_download",
  "tool_parameters": { "data": "{{result}}", "filename": "report.html" } }
```

- Persist the summary to a `staging_*` table first (`save_data(name="staging_…", value="{{result}}", type="json_array")` after `aggregate_data`), so `report_table` reads it by name and joins detail rows on `group_by`.
- `report_table` returns the finished self-contained HTML (brand tokens + Report Context band + "Deterministic" provenance + expandable rows). `chat_download` delivers it with `data="{{result}}"`.
- Do **not** pass a bare JSON array as `data` without `report_table` or a `widget` — `chat_download` would emit a JSON file named `.html`, not a report.

### QuickBooks statements (native format)

For a QuickBooks Profit & Loss or Balance Sheet in a workflow, use the
deterministic renderers instead of a bespoke HTML step — they reproduce QBO's
native layout (section headers, indented line items, ruled subtotals) and return
self-contained HTML:

```json
{ "label": "Build P&L", "tool_id": "report_qbo_pnl",
  "tool_parameters": { "start_date": "{{start_date}}", "end_date": "{{end_date}}", "summarize_column_by": "Total", "accounting_method": "Accrual" } },
{ "label": "Download Report", "tool_id": "chat_download",
  "tool_parameters": { "data": "{{result}}", "filename": "report.html" } }
```

`report_qbo_pnl` / `report_qbo_bs` fetch from QuickBooks Online and render the
statement deterministically (provenance "Deterministic" — no AI).

### Dashboards with charts

If the report needs charts, use Chart.js from CDN. Embed data as JSON literals, render on `<canvas>`. Use the brand palette for series (`#534AB7` brand, `#16a34a` positive, `#dc2626` negative):

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script>
const ALL_TX = ${JSON.stringify(txForDash)};
const BUDGET = ${JSON.stringify(budget)};

function destroyChart(id) {
  const c = Chart.getChart(id);
  if (c) c.destroy();
}

function renderCharts() {
  destroyChart('monthly');
  new Chart(document.getElementById('monthly'), {
    type: 'bar',
    data: { labels: MONTHS, datasets: [
      { label: 'Income', data: incomeByMonth, backgroundColor: '#16a34a' },
      { label: 'Expenses', data: expensesByMonth, backgroundColor: '#dc2626' },
      { label: 'Budget', data: budgetByMonth, type: 'line', borderColor: '#534AB7' }
    ]},
    options: { responsive: true, maintainAspectRatio: false }
  });
  // … more charts
}

renderCharts();
</script>
```

Always `destroyChart(id)` before re-rendering — Chart.js leaks otherwise. Filters re-run `renderCharts()`.

### Do / Don't

| Do | Don't |
|----|-------|
| Use the brand-token `:root` block + inline JS in `<script>` | Pick ad-hoc colors per report, or link external stylesheets / `<script src=…>` (except Chart.js CDN) |
| Build the context band from `api.getReportContext()` | Hand-type the workspace name, period, or source list |
| Let `ctx.provenance` drive the badge; chip model-derived values | Claim "deterministic" while an AI step set values, or chip a number you summed yourself |
| Bake data as `const X = ${JSON.stringify(x)}` | Make any `fetch()` or XHR at view time |
| Pre-render every detail row hidden | Lazy-load drill-down via server roundtrip |
| Include tie-out totals + exclusions note in footer | Omit the "snapshot frozen" disclaimer |
| Escape user-supplied text with `esc()` before HTML insertion | Insert raw vendor names / memos without escaping |
| Sort categories deterministically | Rely on insertion order for ordering |

### What goes in `api.addMessage()`

The chat message is a one-line summary + the download button (added by the next node). Do **not** dump the full report HTML into the chat with `api.addMessage({ html })` — the chat-renderer strips `<script>` and `onclick`, so drill-down won't work inline. The downloaded file is the canonical viewing surface.

If the user explicitly wants an in-chat preview with working interactivity, wrap the report in `<iframe srcdoc="…">` so the chat-renderer's sanitizer doesn't strip the inner scripts. Use sparingly — it duplicates the download chrome.

### Tie-out totals + snapshot disclaimer (auditor checklist)

Every report footer must surface:
- Row count + file count contributing to the report (the source manifest is also in the context band)
- Any explicit exclusions ("Transfers excluded", "Uncategorized counted separately")
- The snapshot disclaimer: "Reclassifying transactions in the workspace will not update this file — re-run the workflow to regenerate."

If the report has aggregates, the footer or a "Totals" row should add up to the sum of all category rows. If a number doesn't tie, say which row it doesn't tie to and why — never silently drop.

### Required helpers

Every report tool defines these locally:

```js
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-$' : '$';
  return sign + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
```
