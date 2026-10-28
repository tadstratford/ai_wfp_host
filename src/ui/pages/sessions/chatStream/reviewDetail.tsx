import type { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import { addMessage } from "@backend/core/session/messages";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { setScope, toRows, buildMasker, maskRow } from "@capabilities/data/scope";
import type { User } from "@backend/types";

const ROW_PREVIEW = 15;

function shortName(name: string): string {
  return (name || "")
    .replace(/^synth_/i, "")
    .replace(/^interco_audit_demo_/i, "")
    .replace(/^ic_report_/i, "")
    .replace(/_/g, " ");
}

function verdictLabel(severity: number): string {
  if (severity >= 0.6) return "🔴 Red";
  if (severity >= 0.3) return "🟡 Yellow";
  return "🟢 Green";
}

function money(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Parse a cell value as a number (strips $ , %), or null when non-numeric. */
function numericValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[$,\s]/g, "").replace(/%$/, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A column is a summable amount only when its NAME suggests a measure, not an
 *  identifier/code/account/date — summing "GL Account", "Txn ID", or "Num" would
 *  produce a meaningless number. */
const AMOUNT_HINT = /\b(amount|balance|total|value|revenue|cost|fee|gross|net|debit|credit|price|principal|interest|sum|headcount|count|qty|quantity|units|hours|area|footage)\b/i;
const ID_HINT = /\b(id|code|num|number|account|gl|txn|invoice|ref|zip|date|class|name|entity|description|memo|status|currency|type|adj|item|posting|month|year|metric)\b/i;
const RATIO_HINT = /%|percent|pct|share|rate|ratio/i;

function isSummable(column: string): boolean {
  return AMOUNT_HINT.test(column) && !ID_HINT.test(column) && !RATIO_HINT.test(column);
}

/** Render a markdown table of `rows` (capped at `preview`), with a **Total** and
 *  **Avg** footer row computed over ALL rows for the summable columns. */
function rowsToMarkdown(columns: string[], rows: Record<string, unknown>[], preview: number): string {
  if (rows.length === 0) return "_(no rows)_";
  const shown = rows.slice(0, preview);
  const header = `| ${columns.map(escapeCell).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = shown
    .map((r) => `| ${columns.map((c) => escapeCell(String(r[c] ?? ""))).join(" | ")} |`)
    .join("\n");

  const sums: (number | null)[] = columns.map(() => null);
  const counts: number[] = columns.map(() => 0);
  for (const r of rows) {
    columns.forEach((c, i) => {
      if (!isSummable(c)) return;
      const n = numericValue(r[c]);
      if (n !== null) {
        sums[i] = (sums[i] ?? 0) + n;
        counts[i]++;
      }
    });
  }

  const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Header, separator, body, Total and Avg must be contiguous lines (a blank line
  // would break the table into fragments); only the "showing N of M" note sits on
  // its own paragraph. Total/Avg put the label in the FIRST column and the sums
  // in the remaining columns, so they line up with the header.
  const lines: string[] = [header, sep, body];
  if (columns.some((_, i) => sums[i] !== null)) {
    const totalCells = columns.map((_, i) => (i === 0 ? "**Total**" : (sums[i] !== null ? fmt(sums[i]!) : "—")));
    const avgCells = columns.map((_, i) => (i === 0 ? "**Avg**" : (counts[i] > 0 ? fmt(sums[i]! / counts[i]) : "—")));
    lines.push(`| ${totalCells.join(" | ")} |`);
    lines.push(`| ${avgCells.join(" | ")} |`);
  }
  const table = lines.join("\n");
  return rows.length > shown.length ? `${table}\n\n_showing ${shown.length} of ${rows.length} rows_` : table;
}

/** Load a table's masked rows from the workspace (same read path as `get_data`). */
function loadTableRows(databaseId: string, tableName: string): { columns: string[]; rows: Record<string, unknown>[]; total: number } | null {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return null;
    const entry = ws.getDataEntry(tableName);
    if (!entry) return null;
    const all = toRows(entry);
    if (all === null) return null;
    const masker = buildMasker();
    const masked = all.map((r) => maskRow(r, masker));
    const columns = (entry.columns ?? (masked.length ? Object.keys(masked[0]) : [])) as string[];
    return { columns, rows: masked, total: masked.length };
  } catch {
    return null;
  }
}

/** The aggregate (ledger ↔ report) edge, if present — the source of the variance. */
function aggregateEdge(review: any): any {
  return (review?.edges ?? []).find((e: any) => e.kind === "aggregate");
}

/** Render the underlying rows (both sides) for a single variance key. */
function renderKeyRows(review: any, databaseId: string, key: string): string {
  const agg = aggregateEdge(review);
  if (!agg) return "";
  const fromT = loadTableRows(databaseId, agg.from);
  const toT = loadTableRows(databaseId, agg.to);
  const out: string[] = [];
  if (fromT) {
    const rows = fromT.rows.filter((r) => String(r[agg.keyCol] ?? "") === key);
    out.push(`**${shortName(agg.from)}:**\n${rowsToMarkdown(fromT.columns, rows, ROW_PREVIEW)}`);
  }
  if (toT) {
    const rows = toT.rows.filter((r) => String(r[agg.keyCol] ?? "") === key);
    out.push(`**${shortName(agg.to)}:**\n${rowsToMarkdown(toT.columns, rows, ROW_PREVIEW)}`);
  }
  return out.join("\n\n");
}

function verdictPointer(review: any, v: any): string {
  if (v.category === "Completeness") {
    const tables = (review.nodes ?? []).filter((n: any) => (n.nullColNames?.length ?? 0) > 0);
    if (tables.length) return tables.map((n: any) => `- \`${n.label}\`: ${n.nullColNames.join(", ")}`).join("\n");
  }
  if (v.category === "Valuation / agreement" || v.category === "Existence / orphans") {
    const mm = (review.variances ?? []).filter((x: any) => Math.abs(x.diff ?? 0) > 1e-6);
    if (mm.length) return mm.map((x: any) => `- ${x.key}: ${money(x.diff)}`).join("\n");
  }
  return "Inspect the tables and links above — click a table or variance row to see the underlying data.";
}

/** Resolve a display-element `ref` against a review payload and render its detail
 *  as markdown (drilling into the underlying rows where available). */
function formatElementDetail(review: any, ref: string, databaseId: string): string | null {
  if (!ref) return null;

  if (ref.startsWith("node-")) {
    const n = review?.nodes?.find((x: any) => x.ref === ref);
    if (!n) return null;
    const head = `**${n.label}** — ${n.role}\n\n${n.rows} rows · ${n.columns} columns · ${n.dupRows} duplicate rows`;
    const blanks = n.nullColNames?.length ? `\n- Blank fields: ${n.nullColNames.join(", ")}` : "";
    const t = loadTableRows(databaseId, n.id);
    if (!t) return `${head}${blanks}\n\n_(non-tabular data — no row preview)_`;
    return `${head}${blanks}\n\n${rowsToMarkdown(t.columns, t.rows, ROW_PREVIEW)}`;
  }

  if (ref.startsWith("var-")) {
    const v = review?.variances?.find((x: any) => x.ref === ref);
    if (!v) return null;
    const diff = Math.abs(v.diff) > 1e-6 ? `${v.diff > 0 ? "+" : ""}${money(v.diff)}` : "ties";
    const rows = renderKeyRows(review, databaseId, v.key);
    const head = `**${v.key}** — ${money(v.left)} → ${money(v.right)} (${diff})`;
    return rows ? `${head}\n\n${rows}` : `${head}\n\n_(no underlying rows found for this key)_`;
  }

  if (ref.startsWith("edge-")) {
    const e = review?.edges?.find((x: any) => x.ref === ref);
    if (!e) return null;
    if (e.kind !== "aggregate") {
      return `**${shortName(e.from)} ↔ ${shortName(e.to)}**\n\n- On \`${e.keyCol}\` (${e.kind})\n- ${e.detail}`;
    }
    const vars = review.variances ?? [];
    const mm = vars.filter((x: any) => Math.abs(x.diff ?? 0) > 1e-6);
    const totalDiff = mm.reduce((s: number, x: any) => s + Number(x.diff ?? 0), 0);
    const parts: string[] = [];
    parts.push(`**${shortName(e.from)} ↔ ${shortName(e.to)}**\n\nOn \`${e.keyCol}\``);
    if (mm.length > 0) {
      const sign = totalDiff > 0 ? "+" : "";
      parts.push(`## Difference: ${sign}${money(totalDiff)}\n\n${mm.length} of ${vars.length} pairs don't tie — ${mm.map((x: any) => `${x.key} ${x.diff > 0 ? "+" : ""}${money(x.diff)}`).join(", ")}`);
    } else {
      parts.push(`## Difference: ${money(0)}\n\nAll ${vars.length} pairs tie.`);
    }
    const keyRows = mm.slice(0, 3).map((x: any) => `### ${x.key} (${x.diff > 0 ? "+" : ""}${money(x.diff)})\n${renderKeyRows(review, databaseId, x.key)}`);
    if (keyRows.length) parts.push(keyRows.join("\n\n"));
    return parts.join("\n\n");
  }

  if (ref.startsWith("verdict-")) {
    const v = review?.verdicts?.find((x: any) => x.ref === ref);
    if (!v) return null;
    return `**${v.category}** — ${verdictLabel(v.severity)}\n\n${v.summary}.\n\n${v.basis}\n\n**Inspect:**\n${verdictPointer(review, v)}`;
  }

  return null;
}

/**
 * POST /sessions/api/review-detail — appends a display element's detail (down to
 * the underlying rows where available) to the end of the session.
 */
export const reviewDetailHandler = async (c: Context) => {
  const sessionId = c.req.query("sessionId") || "";
  const ref = c.req.query("ref") || "";
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;

  if (!sessionId || !ref) return c.text("");

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.text("");

  let review: any = null;
  for (const m of [...(session.messages || [])].reverse()) {
    const r = (m?.json as any)?.review as any;
    if (r && (r.nodes || r.edges || r.verdicts || r.variances)) {
      review = r;
      break;
    }
  }
  if (!review) return c.text("");

  setScope(databaseId);
  const detail = formatElementDetail(review, ref, databaseId);
  if (!detail) return c.text("");

  await addMessage({
    session,
    databaseId,
    role: "assistant",
    source: "review-detail",
    markdown: detail,
    json: { kind: "detail", ref },
  });

  return c.text("");
};
