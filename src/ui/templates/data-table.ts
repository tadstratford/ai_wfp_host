import { register, type TemplateContext } from ".";
import type { WidgetDefinition } from "@shared/types/widgetTypes";
import { extractTable } from "@data/table";

/**
 * data-table — generic table widget.
 *
 * Renders any array of row objects (a `json_array` / flattened `staging_*`
 * table) as a self-contained, brand-styled HTML report. This is the
 * deterministic "table → HTML report" path for workflows: the planner emits
 * `chat_download(widget="data-table", data={{result}})` and the host renders
 * it server-side (no free-form LLM step).
 */

const dataTableDefinition: WidgetDefinition = {
  widget_id: "data-table",
  name: "Data Table",
  description: "Generic tabular data rendered as a self-contained HTML report.",
  description_md: `## What it is
A generic table report. Renders an array of row objects as a styled, frozen
HTML snapshot (brand tokens + title + generated timestamp + a footer note).

## data JSON example
\`\`\`json
[ { "GL Account": 1200, "Account Description": "Inventory Transfer", "Sum of Amount (USD)": 144660 } ]
\`\`\`

- \`data\` MUST be an array of row objects (e.g. \`{{result}}\` from \`aggregate_data\`, or a persisted \`{{staging_*}}\` table).
- Columns are inferred from the first row's keys, in key order.`,
  schema: {
    type: "array",
    items: { type: "object" },
  },
  apiVersion: "1.0.0",
};

const BRAND_CSS = `
:root{
  --wfp-brand:#534AB7; --wfp-brand-tint:#EEF2FF; --wfp-accent:#4f46e5;
  --wfp-ink:#1e1b4b; --wfp-muted:#6b7280; --wfp-line:#e5e7eb; --wfp-bg:#f8f9fc;
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
table.main td{padding:10px 12px;border-bottom:1px solid var(--wfp-line)}
table.main tbody tr:last-child td{border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
footer.wfp-foot{margin-top:18px;padding-top:12px;border-top:1px solid var(--wfp-line);
  color:var(--wfp-muted);font-size:12px}
`;

register(dataTableDefinition, (data: unknown, _ctx: TemplateContext) => {
  const rows = (extractTable(data) ?? []) as Record<string, unknown>[];
  const when = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  const header = (title: string) => `<section class="report-context">
    <div class="eyebrow">Data Report</div>
    <h1>${esc(title)}</h1>
    <div class="meta"><span><b>Generated:</b> ${esc(when)}</span><span><b>Rows:</b> ${rows.length}</span></div>
  </section>`;

  if (rows.length === 0) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}</style></head>
<body><div class="wfp-wrap">
  ${header("Report")}
  <p style="color:var(--wfp-muted)">No data to display.</p>
  <footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer>
</div></body></html>`;
  }

  const columns = Object.keys(rows[0]);
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const v = row[c];
          const isNum = typeof v === "number";
          const cls = isNum ? ' class="num"' : "";
          return `<td${cls}>${esc(v === null || v === undefined ? "" : String(v))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>${BRAND_CSS}</style></head>
<body><div class="wfp-wrap">
  ${header("Report")}
  <table class="main"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  <footer class="wfp-foot">Frozen snapshot — re-run the workflow to regenerate.</footer>
</div></body></html>`;
});

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
