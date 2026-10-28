/**
 * vers_10 resolution (storytelling step 7, report-only) — deterministically
 * assembles a self-contained "error report" from the review findings + the
 * remediation plan, and renders the report download/preview card.
 *
 * Report-only scope: the resolution *delivers a report*. Posting journals /
 * adjusting entries (qbo_journal_create) is deliberately deferred and will cross
 * the write-approval gate separately.
 */

import type { ReviewPayload } from "../vers_9/orchestrator";
import type { StoryAction } from "./plan";

/** True when the review surfaced findings that warrant a resolution report. */
export function hasFindings(review: ReviewPayload): boolean {
  return (
    (review.verdicts ?? []).some((v) => v.severity >= 0.6) ||
    (review.variances ?? []).some((v) => Math.abs(v.diff) > 1e-6)
  );
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMoney(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}

function verdictColor(severity: number): string {
  if (severity >= 0.6) return "#dc2626";
  if (severity >= 0.3) return "#d97706";
  return "#16a34a";
}

function verdictLabel(severity: number): string {
  if (severity >= 0.6) return "Red";
  if (severity >= 0.3) return "Yellow";
  return "Green";
}

/** Assemble the self-contained error-report HTML (brand-styled, no external
 *  assets). Figures/names are templated verbatim from the review payload. */
export function buildErrorReportHtml(
  review: ReviewPayload,
  actions: StoryAction[],
  title: string,
): string {
  const verdictRows = (review.verdicts ?? [])
    .map(
      (v) =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${verdictColor(v.severity)};font-weight:600">${esc(v.category)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${verdictColor(v.severity)}">${verdictLabel(v.severity)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${esc(v.summary)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280">${esc(v.basis)}</td></tr>`,
    )
    .join("\n");

  const varianceRows = (review.variances ?? [])
    .filter((v) => Math.abs(v.diff) > 1e-6)
    .map(
      (v) =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${esc(v.key)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${fmtMoney(v.left)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${fmtMoney(v.right)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#dc2626;font-weight:600">${v.diff > 0 ? "+" : ""}${fmtMoney(v.diff)}</td></tr>`,
    )
    .join("\n");

  const actionItems = (actions ?? [])
    .map((a, i) => `<li style="margin:6px 0">${esc(a.label)}</li>`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
:root{--brand:#534AB7;--brand-tint:#EEF2FF;--ink:#1e1b4b;--muted:#6b7280;--line:#e5e7eb;--bg:#f8f9fc}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:24px}
.ctx{background:#fff;border:1px solid var(--line);border-left:4px solid var(--brand);border-radius:10px;padding:16px 18px;margin-bottom:20px}
.ctx .eyebrow{margin:0 0 4px;font-size:12px;font-weight:600;color:var(--brand);text-transform:uppercase;letter-spacing:.04em}
.ctx h1{margin:0 0 8px;font-size:20px}
.ctx .meta{color:var(--muted);font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-bottom:16px}
.card h2{margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#fafafe;text-align:left;padding:8px 10px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);border-bottom:1px solid var(--line);font-size:11px}
ol{margin:0;padding-left:20px}
footer{margin-top:18px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <div class="ctx">
    <p class="eyebrow">Data review</p>
    <h1>${esc(title)}</h1>
    <div class="meta">Generated ${new Date().toLocaleString()} · deterministic (no AI narration)</div>
  </div>
  <div class="card">
    <h2>Verdicts</h2>
    <table>
      <thead><tr><th>Category</th><th>Verdict</th><th>Summary</th><th>Basis</th></tr></thead>
      <tbody>${verdictRows || '<tr><td colspan="4" style="padding:8px 10px">No verdicts.</td></tr>'}</tbody>
    </table>
  </div>
  ${varianceRows ? `<div class="card">
    <h2>Variances</h2>
    <table>
      <thead><tr><th>Key</th><th style="text-align:right">Left</th><th style="text-align:right">Right</th><th style="text-align:right">Difference</th></tr></thead>
      <tbody>${varianceRows}</tbody>
    </table>
  </div>` : ""}
  <div class="card">
    <h2>Remediation plan</h2>
    ${actionItems ? `<ol>${actionItems}</ol>` : "<p>No actions proposed.</p>"}
  </div>
  <footer>Provenance: assembled deterministically from the review tool evidence. This report is read-only — re-run to regenerate from current data.</footer>
</div>
</body>
</html>`;
}
