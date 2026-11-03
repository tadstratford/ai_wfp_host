/**
 * vers_11 review — deterministic data-review report assembly + the post-battery
 * reconciliation phase. Extracted so vers_11 stays self-contained (no import
 * from a to-be-removed version). No LLM narration here: entity/account names and
 * figures are templated verbatim from tool evidence, so there is no path for
 * hallucination.
 */

import { aggregator } from "../../mcp/aggregator";
import { setParameterValue } from "@backend/core/settings/parameterHelpers";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkbookSheet } from "@shared/wfp-api/xlsx";
import type { EvidenceItem } from "./types";

function extractTextContent(mcpResult: any): string {
  if (mcpResult?.content && Array.isArray(mcpResult.content)) {
    return mcpResult.content.map((c: any) => c.text || "").filter(Boolean).join("\n");
  }
  if (typeof mcpResult === "string") return mcpResult;
  return JSON.stringify(mcpResult);
}

function parseToolOutput(text: string): unknown {
  if (!text) return text;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.parse(t); } catch { return text; }
  }
  return text;
}

// ────────────────────────────────────────────────────────────────
function buildFactsBlock(evidence: EvidenceItem[]): string {
  const lines: string[] = [];
  const profiled = new Set<string>();
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") {
      const name = p?.name;
      if (!name || profiled.has(name)) continue;
      profiled.add(name);
      const nullCols = (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ");
      lines.push(
        `- \`${name}\`: ${p?.rowCount} rows, duplicate rows ${p?.duplicateRows ?? 0}` +
          (nullCols ? `, nulls: ${nullCols}` : ""),
      );
    } else if (e.tool === "aggregate_data") {
      const name = p?.name;
      for (const g of p?.groups ?? []) {
        const key = g?.key
          ? Object.entries(g.key as Record<string, unknown>)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")
          : "(total)";
        const meas = Object.entries(g?.measures ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        lines.push(`- \`${name}\` [${key}]: ${meas}`);
      }
    } else if (e.tool === "reconcile_relationship") {
      const s = p?.summary ?? {};
      lines.push(
        `- reconcile: matched ${s.matched}, mismatched ${s.mismatched}, ` +
          `missing_left ${s.missing_left}, missing_right ${s.missing_right}`,
      );
      for (const m of (p?.mismatches ?? []).slice(0, 20)) {
        lines.push(`  - ${m.key}: left ${m.left} vs right ${m.right} (diff ${m.difference})`);
      }
      for (const k of (p?.missing_right ?? []).slice(0, 10)) {
        lines.push(`  - missing on right: ${k}`);
      }
    } else if (e.tool === "check_data") {
      for (const c of Array.isArray(p) ? p : []) {
        lines.push(`- check \`${c?.id}\`: ${c?.noul}`);
      }
    }
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────
/** Map a deterministic severity (0..1) to a red/yellow/green verdict label. */
function verdictLabel(score: number): string {
  if (score >= 0.6) return "🔴 Red";
  if (score >= 0.3) return "🟡 Yellow";
  return "🟢 Green";
}

/** Deterministic data-review report — assembled directly from the tool evidence,
 *  no LLM narration. Entity/account names and figures are templated verbatim
 *  from the JSON (there is no path for hallucination), and each of the eight
 *  review categories gets a red/yellow/green verdict from fixed thresholds over
 *  the deterministic tool scores. */
export function renderReviewReport(
  evidence: EvidenceItem[],
  relationshipsOutput: any,
  rawMessage: string,
): string {
  const profiles: any[] = [];
  const aggregates: any[] = [];
  const reconciles: any[] = [];
  const checks: { id: string; noul: number }[] = [];
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") profiles.push(p);
    else if (e.tool === "aggregate_data") aggregates.push(p);
    else if (e.tool === "reconcile_relationship") reconciles.push(p);
    else if (e.tool === "check_data" && Array.isArray(p)) {
      for (const c of p) {
        if (c && typeof c?.noul === "number") checks.push({ id: c.id, noul: c.noul });
      }
    }
  }

  const check = (id: string): number => checks.find((x) => x.id === id)?.noul ?? 0;

  if (profiles.length === 0 && aggregates.length === 0 && reconciles.length === 0 && checks.length === 0) {
    return "The review battery returned no evidence — no tables were profiled, aggregated, or reconciled.";
  }

  // ── Scope ────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const scopeRows: string[] = [];
  for (const p of profiles) {
    const name = p?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const nullText =
      (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ") || "—";
    scopeRows.push(
      `| \`${name}\` | ${p?.rowCount ?? "?"} | ${p?.columnCount ?? "?"} | ${p?.duplicateRows ?? 0} | ${nullText} |`,
    );
  }

  // ── Verdicts ─────────────────────────────────────────────────────────────
  const verdicts: { category: string; severity: number; basis: string }[] = [];

  // 1. Completeness
  {
    const nulls = new Map<string, number>();
    for (const p of profiles) {
      for (const c of p?.columns ?? []) {
        if ((c?.nullCount ?? 0) > 0) nulls.set(c.column, (nulls.get(c.column) ?? 0) + c.nullCount);
      }
    }
    const keyRe = /\b(id|name|account|date|amount|entity|gl|txn|currency|status|code|class|description|memo)\b/i;
    const keyNull = [...nulls.keys()].filter((c) => keyRe.test(c));
    let severity = check("missing_key_fields");
    if (keyNull.length > 0) severity = Math.max(severity, 0.9);
    else if (nulls.size > 0) severity = Math.max(severity, 0.4);
    const basis = nulls.size
      ? `null columns: ${[...nulls.entries()].map(([c, n]) => `${c}(${n})`).join(", ")}` +
        (keyNull.length ? " — key fields affected" : "")
      : "no null columns";
    verdicts.push({ category: "Completeness", severity, basis: `${basis}; missing_key_fields ${check("missing_key_fields").toFixed(2)}` });
  }

  // 2. Existence / orphans
  {
    const dup = profiles.reduce((s, p) => s + (p?.duplicateRows ?? 0), 0);
    // Only aggregate diffs signal true orphans (a key present in one source but
    // absent from the other). A "contains" reconcile's "missing" is just partial
    // coverage (e.g. active deals never appear in the write-off ledger), not an
    // orphan, and valuation mismatches belong to the Valuation verdict below.
    const missing = reconciles
      .filter((r) => r?.kind !== "contains")
      .reduce((s, r) => s + (r?.summary?.missing_left ?? 0) + (r?.summary?.missing_right ?? 0), 0);
    let severity = 0;
    if (missing > 0) severity = 0.9;
    else if (dup > 0) severity = 0.5;
    else severity = Math.max(check("renamed_entities"), check("duplicates"));
    verdicts.push({
      category: "Existence / orphans",
      severity,
      basis: `duplicate rows ${dup}; orphans ${missing}; renamed_entities ${check("renamed_entities").toFixed(2)}`,
    });
  }

  // 3. Footing / cross-foot
  {
    const footings: any[] = [];
    for (const p of profiles) for (const f of p?.footings ?? []) footings.push(f);
    let severity: number;
    let basis: string;
    if (footings.length === 0) {
      severity = 0.4;
      basis = "no explicit footings verified (aggregate totals only)";
    } else {
      const failed = footings.filter((f) => f?.holds === false);
      severity = failed.length > 0 ? 0.9 : 0;
      basis = footings
        .map((f) => `${f?.label ?? f?.leftColumn}: ${f?.holds ? "holds" : "DOES NOT hold"}`)
        .join("; ");
    }
    verdicts.push({ category: "Footing / cross-foot", severity, basis });
  }

  // 4. Valuation / agreement
  {
    const realMismatches: any[] = [];
    let matched = 0;
    let mismatched = 0;
    for (const r of reconciles) {
      matched += r?.summary?.matched ?? 0;
      mismatched += r?.summary?.mismatched ?? 0;
      for (const m of r?.mismatches ?? []) {
        if (Math.abs(Number(m?.difference ?? 0)) > 1e-6) realMismatches.push(m);
      }
    }
    let severity: number;
    let basis: string;
    if (reconciles.length === 0) {
      severity = 0.4;
      basis = "no relationships reconciled";
    } else {
      severity = realMismatches.length > 0 ? 0.9 : 0;
      basis = `matched ${matched}, mismatched ${mismatched}` +
        (realMismatches.length
          ? ` — e.g. ${realMismatches.slice(0, 3).map((m) => `${m.key} diff ${m.difference}`).join("; ")}`
          : "");
    }
    verdicts.push({ category: "Valuation / agreement", severity, basis });
  }

  // 5. Classification / allocation
  {
    const severity = Math.max(check("miscoded"), check("unallocated"));
    verdicts.push({
      category: "Classification / allocation",
      severity,
      basis: `miscoded ${check("miscoded").toFixed(2)}, unallocated ${check("unallocated").toFixed(2)}`,
    });
  }

  // 6. Cutoff / timing
  {
    const severity = check("date_issues");
    verdicts.push({ category: "Cutoff / timing", severity, basis: `date_issues ${check("date_issues").toFixed(2)}` });
  }

  // 7. Consistency
  {
    let severity = Math.max(check("inconsistent_naming"), check("renamed_entities"));
    const suspense = aggregates
      .flatMap((a) => a?.groups ?? [])
      .filter((g) => /to be allocated|suspense|clearing/i.test(g?.key ? JSON.stringify(g.key) : ""));
    const nonZero = suspense.filter((g) => {
      const v = Object.values(g?.measures ?? {})[0];
      return Math.abs(Number(v ?? 0)) > 1e-6;
    });
    if (nonZero.length > 0) severity = Math.max(severity, 0.9);
    verdicts.push({
      category: "Consistency",
      severity,
      basis: `inconsistent_naming ${check("inconsistent_naming").toFixed(2)}, renamed_entities ${check("renamed_entities").toFixed(2)}; suspense/clearing non-zero groups: ${nonZero.length}`,
    });
  }

  // 8. No guessing
  {
    const hasNulls = profiles.some((p) => (p?.columns ?? []).some((c: any) => (c?.nullCount ?? 0) > 0));
    const severity = Math.max(check("amount_sign"), hasNulls ? 0.4 : 0);
    verdicts.push({
      category: "No guessing",
      severity,
      basis: `amount_sign ${check("amount_sign").toFixed(2)}; unresolved nulls ${hasNulls ? "present" : "none"}`,
    });
  }

  // ── Assemble ─────────────────────────────────────────────────────────────
  const title = /review|audit/i.test(rawMessage) ? "Data review" : "Data analysis";
  const lines: string[] = [`# ${title}`];
  if (scopeRows.length) {
    lines.push("", "## Scope", "| Table | Rows | Columns | Duplicate rows | Null columns |", "|---|---|---|---|---|", ...scopeRows);
  }
  lines.push("", "## Verdicts", "| Category | Verdict | Basis |", "|---|---|---|");
  for (const v of verdicts) lines.push(`| ${v.category} | ${verdictLabel(v.severity)} | ${v.basis} |`);

  const facts = buildFactsBlock(evidence);
  if (facts) lines.push("", "## Verified facts (read directly from tool output)", facts);

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────
/** Format a money amount as a signed dollar figure (whole dollars). */
function fmtMoney(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  return `${rounded < 0 ? "-" : ""}$${abs.toLocaleString("en-US")}`;
}

/** Assign a table a display role for the relationship map. */
function roleOf(name: string): string {
  const n = name.toLowerCase();
  if (/transaction|ledger|journal|subledger/.test(n)) return "ledger";
  if (/exception|flag|action|worklist|unallocated/.test(n)) return "worklist";
  if (/elimination|summary|trial|balance|check/.test(n)) return "summary";
  if (/position|statement|report/.test(n)) return "report";
  if (/rule|basis|headcount|revenue|footage|rate|mapping|allocation/.test(n)) return "reference";
  return "other";
}

/** A review category's red/yellow/green verdict plus a plain-language summary. */
export interface ReviewVerdict {
  category: string;
  severity: number;
  summary: string;
  basis: string;
  ref: string;
}

export interface ReviewNode {
  id: string;
  ref: string;
  label: string;
  role: string;
  rows: number;
  columns: number;
  dupRows: number;
  nullCols: number;
  nullColNames: string[];
}

export interface ReviewEdge {
  from: string;
  to: string;
  ref: string;
  keyCol: string;
  kind: string;
  status: "tie" | "variance" | "partial" | "unknown";
  label: string;
  detail: string;
}

export interface ReviewVariance {
  key: string;
  left: number;
  right: number;
  diff: number;
  ref: string;
}

export interface ReviewPayload {
  title: string;
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  variances: ReviewVariance[];
  verdicts: ReviewVerdict[];
  narration?: string;
  notes?: string[];
}

// ────────────────────────────────────────────────────────────────
interface EvidenceCtx {
  profiles: any[];
  aggregates: any[];
  reconciles: any[];
  checks: { id: string; noul: number }[];
  check: (id: string) => number;
}

function parseEvidence(evidence: EvidenceItem[]): EvidenceCtx {
  const profiles: any[] = [];
  const aggregates: any[] = [];
  const reconciles: any[] = [];
  const checks: { id: string; noul: number }[] = [];
  for (const e of evidence) {
    let p: any;
    try {
      p = JSON.parse(e.summary);
    } catch {
      continue;
    }
    if (e.tool === "profile_data") profiles.push(p);
    else if (e.tool === "aggregate_data") aggregates.push(p);
    else if (e.tool === "reconcile_relationship") reconciles.push(p);
    else if (e.tool === "check_data" && Array.isArray(p)) {
      for (const c of p) {
        if (c && typeof c?.noul === "number") checks.push({ id: c.id, noul: c.noul });
      }
    }
  }
  const check = (id: string): number => checks.find((x) => x.id === id)?.noul ?? 0;
  return { profiles, aggregates, reconciles, checks, check };
}

/** Compute the eight review verdicts (severity + technical basis + one-line
 *  plain-language summary) from the deterministic evidence. */
function computeVerdicts(ctx: EvidenceCtx): Omit<ReviewVerdict, "ref">[] {
  const { profiles, aggregates, reconciles, check } = ctx;
  const verdicts: Omit<ReviewVerdict, "ref">[] = [];

  {
    const nulls = new Map<string, number>();
    for (const p of profiles) {
      for (const c of p?.columns ?? []) {
        if ((c?.nullCount ?? 0) > 0) nulls.set(c.column, (nulls.get(c.column) ?? 0) + c.nullCount);
      }
    }
    const keyRe = /\b(id|name|account|date|amount|entity|gl|txn|currency|status|code|class|description|memo)\b/i;
    const keyNull = [...nulls.keys()].filter((c) => keyRe.test(c));
    let severity = check("missing_key_fields");
    if (keyNull.length > 0) severity = Math.max(severity, 0.9);
    else if (nulls.size > 0) severity = Math.max(severity, 0.4);
    const basis = nulls.size
      ? `null columns: ${[...nulls.entries()].map(([c, n]) => `${c}(${n})`).join(", ")}` +
        (keyNull.length ? " — key fields affected" : "")
      : "no null columns";
    const summary = keyNull.length > 0
      ? `${keyNull.length} key field${keyNull.length === 1 ? "" : "s"} blank`
      : nulls.size > 0
        ? `${nulls.size} column${nulls.size === 1 ? "" : "s"} have blanks`
        : "no missing fields";
    verdicts.push({ category: "Completeness", severity, summary, basis: `${basis}; missing_key_fields ${check("missing_key_fields").toFixed(2)}` });
  }

  {
    const dup = profiles.reduce((s, p) => s + (p?.duplicateRows ?? 0), 0);
    const missing = reconciles
      .filter((r) => r?.kind !== "contains")
      .reduce((s, r) => s + (r?.summary?.missing_left ?? 0) + (r?.summary?.missing_right ?? 0), 0);
    let severity = 0;
    if (missing > 0) severity = 0.9;
    else if (dup > 0) severity = 0.5;
    else severity = Math.max(check("renamed_entities"), check("duplicates"));
    const summary = missing > 0
      ? `${missing} orphan key${missing === 1 ? "" : "s"}`
      : dup > 0
        ? `${dup} duplicate row${dup === 1 ? "" : "s"}`
        : check("renamed_entities") >= 0.6
          ? "possible renamed entities"
          : "no orphans";
    verdicts.push({
      category: "Existence / orphans",
      severity,
      summary,
      basis: `duplicate rows ${dup}; orphans ${missing}; renamed_entities ${check("renamed_entities").toFixed(2)}`,
    });
  }

  {
    const footings: any[] = [];
    for (const p of profiles) for (const f of p?.footings ?? []) footings.push(f);
    let severity: number;
    let basis: string;
    let summary: string;
    if (footings.length === 0) {
      severity = 0.4;
      basis = "no explicit footings verified (aggregate totals only)";
      summary = "totals not auto-verified";
    } else {
      const failed = footings.filter((f) => f?.holds === false);
      severity = failed.length > 0 ? 0.9 : 0;
      basis = footings
        .map((f) => `${f?.label ?? f?.leftColumn}: ${f?.holds ? "holds" : "DOES NOT hold"}`)
        .join("; ");
      summary = failed.length > 0 ? `${failed.length} footing${failed.length === 1 ? "" : "s"} fail` : "footings hold";
    }
    verdicts.push({ category: "Footing / cross-foot", severity, summary, basis });
  }

  {
    const realMismatches: any[] = [];
    let matched = 0;
    let mismatched = 0;
    for (const r of reconciles) {
      matched += r?.summary?.matched ?? 0;
      mismatched += r?.summary?.mismatched ?? 0;
      for (const m of r?.mismatches ?? []) {
        if (Math.abs(Number(m?.difference ?? 0)) > 1e-6) realMismatches.push(m);
      }
    }
    let severity: number;
    let basis: string;
    let summary: string;
    if (reconciles.length === 0) {
      severity = 0.4;
      basis = "no relationships reconciled";
      summary = "not yet reconciled";
    } else {
      severity = realMismatches.length > 0 ? 0.9 : 0;
      basis = `matched ${matched}, mismatched ${mismatched}` +
        (realMismatches.length
          ? ` — e.g. ${realMismatches.slice(0, 3).map((m) => `${m.key} diff ${m.difference}`).join("; ")}`
          : "");
      const net = realMismatches.reduce((s, m) => s + Number(m?.difference ?? 0), 0);
      summary = realMismatches.length > 0
        ? `${realMismatches.length} value${realMismatches.length === 1 ? "" : "s"} don't tie (net ${fmtMoney(net)})`
        : "all values tie";
    }
    verdicts.push({ category: "Valuation / agreement", severity, summary, basis });
  }

  {
    const severity = Math.max(check("miscoded"), check("unallocated"));
    const summary = check("unallocated") >= 0.6
      ? "large unallocated share"
      : check("miscoded") >= 0.6
        ? "coding issues"
        : "classification clean";
    verdicts.push({
      category: "Classification / allocation",
      severity,
      summary,
      basis: `miscoded ${check("miscoded").toFixed(2)}, unallocated ${check("unallocated").toFixed(2)}`,
    });
  }

  {
    const severity = check("date_issues");
    const summary = severity >= 0.6 ? "date/timing problems" : "timing clean";
    verdicts.push({ category: "Cutoff / timing", severity, summary, basis: `date_issues ${check("date_issues").toFixed(2)}` });
  }

  {
    let severity = Math.max(check("inconsistent_naming"), check("renamed_entities"));
    const suspense = aggregates
      .flatMap((a) => a?.groups ?? [])
      .filter((g) => /to be allocated|suspense|clearing/i.test(g?.key ? JSON.stringify(g.key) : ""));
    const nonZero = suspense.filter((g) => {
      const v = Object.values(g?.measures ?? {})[0];
      return Math.abs(Number(v ?? 0)) > 1e-6;
    });
    if (nonZero.length > 0) severity = Math.max(severity, 0.9);
    const summary = severity >= 0.6 ? "naming inconsistencies" : "naming consistent";
    verdicts.push({
      category: "Consistency",
      severity,
      summary,
      basis: `inconsistent_naming ${check("inconsistent_naming").toFixed(2)}, renamed_entities ${check("renamed_entities").toFixed(2)}; suspense/clearing non-zero groups: ${nonZero.length}`,
    });
  }

  {
    const hasNulls = profiles.some((p) => (p?.columns ?? []).some((c: any) => (c?.nullCount ?? 0) > 0));
    const severity = Math.max(check("amount_sign"), hasNulls ? 0.4 : 0);
    const summary = check("amount_sign") >= 0.6
      ? "unexpected signs"
      : hasNulls
        ? "some blanks remain"
        : "no signs of guessing";
    verdicts.push({
      category: "No guessing",
      severity,
      summary,
      basis: `amount_sign ${check("amount_sign").toFixed(2)}; unresolved nulls ${hasNulls ? "present" : "none"}`,
    });
  }

  return verdicts;
}

/** Assemble the structured visual payload (relationship map + variance strip +
 *  verdict cards) plus the two markdown strings the turn needs: `verify` (full
 *  text for Jev) and `receipts` (scope + facts only, shown collapsed). Returns
 *  null when the battery produced no evidence. */

// ────────────────────────────────────────────────────────────────
export function buildReview(
  evidence: EvidenceItem[],
  relationshipsOutput: any,
  rawMessage: string,
): { payload: ReviewPayload; verify: string; receipts: string } | null {
  const ctx = parseEvidence(evidence);
  const { profiles, aggregates, reconciles } = ctx;
  if (profiles.length === 0 && aggregates.length === 0 && reconciles.length === 0 && ctx.checks.length === 0) {
    return null;
  }

  const title = /review|audit/i.test(rawMessage) ? "Data review" : "Data analysis";
  const nodes: ReviewNode[] = profiles.map((p, i) => ({
    id: p?.name,
    ref: `node-${i}`,
    label: shortTableName(p?.name ?? ""),
    role: roleOf(p?.name ?? ""),
    rows: p?.rowCount ?? 0,
    columns: p?.columnCount ?? 0,
    dupRows: p?.duplicateRows ?? 0,
    nullCols: (p?.columns ?? []).filter((c: any) => (c?.nullCount ?? 0) > 0).length,
    nullColNames: (p?.columns ?? [])
      .filter((c: any) => (c?.nullCount ?? 0) > 0)
      .map((c: any) => `${c.column} (${c.nullCount})`),
  }));

  const edges: ReviewEdge[] = [];
  const variances: ReviewVariance[] = [];
  const seen = new Set<string>();
  for (const r of reconciles) {
    const lt = r?.left;
    const rt = r?.right;
    if (!lt || !rt) continue;
    const key = `${lt}|${rt}|${r?.on_left ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r?.kind === "aggregate") {
      const mm = r?.mismatches ?? [];
      const ms = r?.matches ?? [];
      const totalDiff = mm.reduce((s: number, m: any) => s + Number(m?.difference ?? 0), 0);
      const diffParts = mm.map((m: any) => `${m.key} ${fmtMoney(Number(m?.difference ?? 0))}`);
      const tieParts = ms.map((m: any) => `${m.key} tie`);
      edges.push({
        from: lt,
        to: rt,
        ref: `edge-${edges.length}`,
        keyCol: r?.on_left ?? "",
        kind: "aggregate",
        status: mm.length > 0 ? "variance" : "tie",
        label: mm.length > 0
          ? `${r?.on_left ?? ""} · ${mm.length} differ (${fmtMoney(totalDiff)})`
          : `${r?.on_left ?? ""} · ties`,
        detail: [diffParts.join("; "), tieParts.join("; ")].filter(Boolean).join("; "),
      });
      for (const m of ms) variances.push({ key: m.key, left: m.left, right: m.right, diff: 0, ref: "" });
      for (const m of mm) variances.push({ key: m.key, left: m.left, right: m.right, diff: Number(m?.difference ?? 0), ref: "" });
    } else {
      const s = r?.summary ?? {};
      const total = (s.matched ?? 0) + (s.missing_left ?? 0) + (s.missing_right ?? 0);
      const status: ReviewEdge["status"] = (s.mismatched ?? 0) > 0
        ? "variance"
        : (s.missing_left ?? 0) + (s.missing_right ?? 0) > 0
          ? "partial"
          : "tie";
      edges.push({
        from: lt,
        to: rt,
        ref: `edge-${edges.length}`,
        keyCol: r?.on_left ?? "",
        kind: r?.kind ?? "",
        status,
        label: `${r?.on_left ?? ""} · ${s.matched ?? 0}/${total} matched`,
        detail: `matched ${s.matched ?? 0}, mismatched ${s.mismatched ?? 0}, missing ${(s.missing_left ?? 0) + (s.missing_right ?? 0)}`,
      });
    }
  }

  // (Faint "shares <column>" links were removed — they added noise without
  // insight. The map now shows only reconciled edges.)

  // Mismatches first (largest diff), then ties — so the variance strip leads
  // with the problems.
  variances.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const variancesRef: ReviewVariance[] = variances.map((v, i) => ({ ...v, ref: `var-${i}` }));

  const verdicts = computeVerdicts(ctx).map((v, i) => ({ ...v, ref: `verdict-${i}` }));

  const seenScope = new Set<string>();
  const scopeRows: string[] = [];
  for (const p of profiles) {
    const name = p?.name;
    if (!name || seenScope.has(name)) continue;
    seenScope.add(name);
    const nullText =
      (p?.columns ?? [])
        .filter((c: any) => (c?.nullCount ?? 0) > 0)
        .map((c: any) => `${c.column}(${c.nullCount})`)
        .join(", ") || "—";
    scopeRows.push(`| \`${name}\` | ${p?.rowCount ?? "?"} | ${p?.columnCount ?? "?"} | ${p?.duplicateRows ?? 0} | ${nullText} |`);
  }
  const receiptsLines: string[] = [];
  if (scopeRows.length) {
    receiptsLines.push("## Scope", "| Table | Rows | Columns | Duplicate rows | Null columns |", "|---|---|---|---|---|", ...scopeRows);
  }
  const facts = buildFactsBlock(evidence);
  if (facts) receiptsLines.push("", "## Verified facts (read directly from tool output)", facts);
  const receipts = receiptsLines.join("\n");

  const verify = renderReviewReport(evidence, relationshipsOutput, rawMessage);

  return { payload: { title, nodes, edges, variances: variancesRef, verdicts }, verify, receipts };
}

// ────────────────────────────────────────────────────────────────
/** Columns whose name suggests a numeric "amount" to foot/reconcile. */
const AMOUNT_HINT = /amount|total|balance|debit|credit|fee|revenue|cost|principal|interest|value|price|gross|net|sum/i;

/** Columns that are ratios/proportions, not absolute amounts (e.g. "% of
 *  Total"). These must never be reconciled against a currency amount — comparing
 *  a percentage to dollars produces a meaningless "difference". */
const RATIO_HINT = /%|percent|pct|share|ratio|proportion|rate\b/i;

/** True when a column name/type represents a ratio or percentage rather than an
 *  absolute amount. */
function isRatioColumn(column: string, types: Record<string, string> | null): boolean {
  if (RATIO_HINT.test(column)) return true;
  const t = types?.[column];
  if (typeof t === "string") return /percent|percentage|ratio/i.test(t);
  return false;
}

/** Resolve a table's numeric amount column (inferred type first, name second)
 *  so a discovered relationship can be reconciled without guessing a column.
 *  Ratio/percentage columns are excluded: they are not absolute amounts. */
function pickAmountColumn(databaseId: string, tableName: string): string | null {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return null;
    const e = ws.getDataEntry(tableName);
    if (!e) return null;
    const columns: string[] = Array.isArray(e?.columns) ? (e.columns as string[]) : [];
    const types = (e?.column_types as Record<string, string> | null) ?? null;
    const numeric = columns.filter((c) => {
      if (isRatioColumn(c, types)) return false;
      const t = types?.[c];
      if (typeof t === "string") return /number|integer|float|decimal|currency|percent/i.test(t);
      return AMOUNT_HINT.test(c);
    });
    // Only a genuine amount-named column qualifies; a table with just counts or
    // percentages (e.g. a headcount basis table) yields null and is skipped.
    return numeric.find((c) => AMOUNT_HINT.test(c)) ?? null;
  } catch {
    return null;
  }
}

/** Resolve a column's inferred type string (empty string when unknown). */
function columnType(databaseId: string, tableName: string, column: string): string {
  try {
    const ws = getSessionByDatabaseId(databaseId);
    if (!ws) return "";
    const e = ws.getDataEntry(tableName);
    if (!e) return "";
    const types = (e?.column_types as Record<string, string> | null) ?? null;
    return (typeof types?.[column] === "string" ? types[column] : "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when two amount columns can be meaningfully compared. A percentage/ratio
 *  is never comparable to a currency, so such a pairing is rejected. */
function amountsComparable(
  databaseId: string,
  leftTable: string,
  leftCol: string,
  rightTable: string,
  rightCol: string,
): boolean {
  const lt = columnType(databaseId, leftTable, leftCol);
  const rt = columnType(databaseId, rightTable, rightCol);
  const isPercent = (t: string, name: string) => /percent|percentage|ratio/.test(t) || RATIO_HINT.test(name);
  const lp = isPercent(lt, leftCol);
  const rp = isPercent(rt, rightCol);
  if (lp || rp) return lp === rp;
  const currency = (t: string) => /currency|decimal|number|float|integer/i.test(t);
  return currency(lt) && currency(rt);
}

/** Rank a discovered relationship by how meaningful a reconcile it yields: a
 *  "contains" link (key embedded in a text column, e.g. a deal name inside a
 *  description) or an entity/name-keyed link beats a trivial ID-to-ID equality
 *  join, which would otherwise surface "missing" rows that are missing by design. */
function rankRelationship(rel: any): number {
  let score = 0;
  if (rel?.kind === "contains") score += 4;
  const idHint = /\b(id|code|num|txn|ref|seq|no)\b/i;
  const keyCols = [rel?.left?.column ?? "", rel?.right?.column ?? ""];
  if (keyCols.some((c) => !idHint.test(c))) score += 2;
  if (keyCols.every((c) => !idHint.test(c))) score += 1;
  score += Number(rel?.confidence ?? 0);
  score += Math.min(1, Number(rel?.coverage ?? 0));
  return score;
}

/** A candidate cross-source valuation pair: two tables aggregated on the same
 *  group-key column, each with a currency measure. Offered to the user as a menu
 *  when the data does not make the ledger-vs-report pairing explicit. */
export interface CandidatePair {
  index: number;
  leftTable: string;
  rightTable: string;
  keyCol: string;
  leftMeasure: string;
  rightMeasure: string;
  leftShort: string;
  rightShort: string;
}
/** Shorten a table name for a menu (strip synthetic/long prefixes). */
function shortTableName(name: string): string {
  return name
    .replace(/^synth_/i, "")
    .replace(/^interco_audit_demo_/i, "")
    .replace(/^ic_report_/i, "")
    .replace(/_/g, " ");
}

/** True when an aggregate measure key (e.g. "sum_Amount (USD)") represents a
 *  currency-ish amount rather than a count or a percentage. */
function isCurrencyMeasure(measureKey: string): boolean {
  const col = measureKey.replace(/^sum_/i, "");
  if (RATIO_HINT.test(col)) return false;
  if (/\b(usd|eur|gbp|jpy|chf|cad|aud|nzd|\$)\b/i.test(col)) return true;
  return AMOUNT_HINT.test(col) && !/count|headcount|qty|quantity|units|employees/i.test(col);
}

/** Discover candidate valuation pairs from the aggregate evidence: tables that
 *  were aggregated on the SAME group-key column with a currency measure. */
function buildCandidatePairs(aggregates: any[]): CandidatePair[] {
  const byKey = new Map<string, { table: string; measure: string; short: string }[]>();
  for (const a of aggregates) {
    const groups = a?.groups ?? [];
    if (!groups.length) continue;
    const keyObj = groups[0]?.key ?? {};
    const keyCols = Object.keys(keyObj);
    if (keyCols.length === 0) continue;
    const keyCol = keyCols[0];
    const measureKeys = Object.keys(groups[0]?.measures ?? {});
    const measure = measureKeys.find((m) => isCurrencyMeasure(m)) ?? null;
    const name = a?.name;
    if (!measure || !name) continue;
    if (!byKey.has(keyCol)) byKey.set(keyCol, []);
    byKey.get(keyCol)!.push({ table: name, measure, short: shortTableName(name) });
  }
  const pairs: CandidatePair[] = [];
  for (const [keyCol, entries] of byKey) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        pairs.push({
          index: pairs.length,
          leftTable: entries[i].table,
          rightTable: entries[j].table,
          keyCol,
          leftMeasure: entries[i].measure,
          rightMeasure: entries[j].measure,
          leftShort: entries[i].short,
          rightShort: entries[j].short,
        });
      }
    }
  }
  return pairs;
}

/** Diff two aggregates on a shared key, producing a result shaped like
 *  `reconcile_relationship` so the deterministic renderer consumes it unchanged. */
function diffAggregates(leftAgg: any, rightAgg: any, pair: CandidatePair): any {
  const lv = new Map<string, number>();
  const rv = new Map<string, number>();
  for (const g of leftAgg?.groups ?? []) {
    const v = g?.key?.[pair.keyCol];
    const m = g?.measures?.[pair.leftMeasure];
    if (v === undefined || v === null || m === undefined || m === null) continue;
    lv.set(String(v), Number(m));
  }
  for (const g of rightAgg?.groups ?? []) {
    const v = g?.key?.[pair.keyCol];
    const m = g?.measures?.[pair.rightMeasure];
    if (v === undefined || v === null || m === undefined || m === null) continue;
    rv.set(String(v), Number(m));
  }
  const mismatches: any[] = [];
  const matches: any[] = [];
  const missing_left: string[] = [];
  const missing_right: string[] = [];
  let matched = 0;
  for (const [k, l] of lv) {
    if (!rv.has(k)) {
      missing_right.push(k);
      continue;
    }
    const r = rv.get(k)!;
    const difference = Math.round(((l ?? 0) - (r ?? 0)) * 100) / 100;
    if (Math.abs(difference) > 1e-6) mismatches.push({ key: k, left: l, right: r, difference });
    else {
      matched++;
      matches.push({ key: k, left: l, right: r });
    }
  }
  for (const k of rv.keys()) if (!lv.has(k)) missing_left.push(k);
  return {
    left: pair.leftTable,
    right: pair.rightTable,
    on_left: pair.keyCol,
    on_right: pair.keyCol,
    kind: "aggregate",
    tolerance: 0,
    summary: {
      matched,
      mismatched: mismatches.length,
      missing_left: missing_left.length,
      missing_right: missing_right.length,
    },
    mismatches,
    matches,
    missing_right,
    missing_left,
  };
}

/** Resolve a user's menu selection into a candidate pair. Accepts an ordinal
 *  ("first"/"second"), any in-range number ("1", "please do 1", "option 2"),
 *  or the two table names. Returns null when nothing selects a pair. */
function resolveClarifyChoice(message: string, candidates: CandidatePair[]): CandidatePair | null {
  const m = message.trim();
  const lower = m.toLowerCase();

  const ordinals = ["first", "second", "third", "fourth", "fifth"];
  const ordinalIdx = ordinals.findIndex((o) => new RegExp(`\\b${o}\\b`).test(lower));
  if (ordinalIdx >= 0 && ordinalIdx < candidates.length) return candidates[ordinalIdx];

  for (const mm of m.matchAll(/(\d+)/g)) {
    const idx = parseInt(mm[1], 10) - 1;
    if (idx >= 0 && idx < candidates.length) return candidates[idx];
  }

  const matched = candidates.filter((c) => {
    const l = [c.leftShort, c.leftTable].map((x) => x.toLowerCase()).filter(Boolean);
    const r = [c.rightShort, c.rightTable].map((x) => x.toLowerCase()).filter(Boolean);
    return l.some((x) => lower.includes(x)) && r.some((y) => lower.includes(y));
  });
  return matched.length === 1 ? matched[0] : null;
}

/** The post-battery reconciliation phase, factored out so vers_11 can reuse the
 *  same dynamic reconcile + aggregate-diff the deterministic report depends on.
 *  Consumes the collected evidence + `list_relationships` output, adds
 *  `reconcile_relationship` / aggregate-diff evidence, and returns the augmented
 *  evidence plus any ambiguous valuation pair that still needs the user to pick. */
export async function reconcileReviewEvidence(opts: {
  databaseId: string;
  session: any;
  evidence: EvidenceItem[];
  relationshipsOutput: any;
}): Promise<{ evidence: EvidenceItem[]; toolsUsed: string[]; pendingClarify: CandidatePair[] }> {
  const evidence = opts.evidence.slice();
  const toolsUsed: string[] = [];
  const relationshipsOutput = opts.relationshipsOutput;
  const session = opts.session;

  const rels = (Array.isArray(relationshipsOutput?.relationships) ? relationshipsOutput.relationships : [])
    .filter((r: any) => r?.kind === "contains")
    .slice()
    .sort((a: any, b: any) => rankRelationship(b) - rankRelationship(a))
    .slice(0, 2);

  for (const rel of rels) {
    const relId = rel?.id;
    const leftTable = rel?.left?.table;
    const rightTable = rel?.right?.table;
    if (!relId || !leftTable || !rightTable) continue;
    const compareLeft = pickAmountColumn(opts.databaseId, leftTable);
    const compareRight = pickAmountColumn(opts.databaseId, rightTable);
    if (!compareLeft || !compareRight) continue;
    if (!amountsComparable(opts.databaseId, leftTable, compareLeft, rightTable, compareRight)) continue;
    try {
      const args = { relationship_id: relId, compare_left: compareLeft, compare_right: compareRight };
      const mcpResult = await aggregator.callTool("reconcile_relationship", args);
      const full = extractTextContent(mcpResult);
      evidence.push({ tool: "reconcile_relationship", summary: full.slice(0, 2500) });
      toolsUsed.push("reconcile_relationship");
      session.parameters = setParameterValue(session.parameters, "result", {
        _meta: { type: "text" },
        data: parseToolOutput(full),
      });
    } catch (err: any) {
      console.error(`[vers_9] reconcileReviewEvidence reconcile error:`, err.message);
    }
  }

  const aggregates = evidence
    .filter((e) => e.tool === "aggregate_data")
    .map((e) => {
      try { return JSON.parse(e.summary); } catch { return null; }
    })
    .filter(Boolean) as any[];

  const forcedChoice = (session?.metadata as any)?.clarifyChoice as CandidatePair | null | undefined;
  let pendingClarify: CandidatePair[] = [];

  if (forcedChoice) {
    const leftAgg = aggregates.find((a) => a?.name === forcedChoice.leftTable);
    const rightAgg = aggregates.find((a) => a?.name === forcedChoice.rightTable);
    if (leftAgg && rightAgg) {
      evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, forcedChoice)) });
      toolsUsed.push("reconcile_relationship");
    }
  } else {
    const pairs = buildCandidatePairs(aggregates);
    const preferred = pairs.filter((p) => {
      const lr = roleOf(p.leftTable);
      const rr = roleOf(p.rightTable);
      return (lr === "ledger" && rr === "report") || (lr === "report" && rr === "ledger");
    });
    const candidates = preferred.length > 0 ? preferred : pairs;
    if (candidates.length === 1) {
      const p = candidates[0];
      const leftAgg = aggregates.find((a) => a?.name === p.leftTable);
      const rightAgg = aggregates.find((a) => a?.name === p.rightTable);
      if (leftAgg && rightAgg) {
        evidence.push({ tool: "reconcile_relationship", summary: JSON.stringify(diffAggregates(leftAgg, rightAgg, p)) });
        toolsUsed.push("reconcile_relationship");
      }
    } else if (candidates.length > 1) {
      pendingClarify = candidates.map((c, i) => ({ ...c, index: i }));
    }
  }

  return { evidence, toolsUsed, pendingClarify };
}

// ────────────────────────────────────────────────────────────────
// Resolution-beat report — a self-contained HTML document assembled
// deterministically from the review payload (verdicts, variances, findings,
// scope, relationships). Figures and names are templated verbatim — no LLM, no
// narration. Delivered by the executor via `buildReportMessage`/`chat_download`.

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlMoney(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString("en-US")}`;
}

function htmlVerdictColor(severity: number): string {
  if (severity >= 0.6) return "#dc2626";
  if (severity >= 0.3) return "#d97706";
  return "#16a34a";
}

function htmlVerdictLabel(severity: number): string {
  if (severity >= 0.6) return "Red";
  if (severity >= 0.3) return "Yellow";
  return "Green";
}

export function buildReviewReportHtml(review: ReviewPayload): string {
  const title = review.title || "Data review";

  const verdictRows = (review.verdicts ?? [])
    .map((v) => {
      const c = htmlVerdictColor(v.severity);
      return `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${c};font-weight:600">${escHtml(v.category)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:${c}">${htmlVerdictLabel(v.severity)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escHtml(v.summary)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280">${escHtml(v.basis)}</td></tr>`;
    })
    .join("\n");

  const varianceRows = (review.variances ?? [])
    .filter((v) => Math.abs(v.diff) > 1e-6)
    .map(
      (v) =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${escHtml(v.key)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${htmlMoney(v.left)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${htmlMoney(v.right)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#dc2626;font-weight:600">${v.diff > 0 ? "+" : ""}${htmlMoney(v.diff)}</td></tr>`,
    )
    .join("\n");

  const findings = (review.verdicts ?? []).filter((v) => v.severity >= 0.6);
  const findingItems = findings
    .map(
      (v) =>
        `<li style="margin:6px 0"><strong>${escHtml(v.category)}</strong> — ${escHtml(v.summary)}. <span style="color:#6b7280">${escHtml(v.basis)}</span></li>`,
    )
    .join("\n");

  const scopeRows = (review.nodes ?? [])
    .map(
      (n) =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600">${escHtml(n.label)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escHtml(n.role)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${n.rows}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${n.columns}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right">${n.dupRows}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escHtml(n.nullColNames.join(", ") || "—")}</td></tr>`,
    )
    .join("\n");

  const relField = (label: string, value: string, muted = false) =>
    `<div style="margin-bottom:6px"><span style="color:#6b7280;font-weight:600;font-size:12px">${label}: </span>` +
    `<span${muted ? ' style="color:#6b7280"' : ""}>${value}</span></div>`;

  const edgeRows = (review.edges ?? [])
    .map(
      (e) =>
        `<div style="padding:10px 12px;border-bottom:1px solid #e5e7eb">` +
        relField("From", escHtml(e.from)) +
        relField("To", escHtml(e.to)) +
        relField("Status", escHtml(e.status)) +
        relField("Key column", escHtml(e.keyCol)) +
        relField("Detail", escHtml(e.detail), true) +
        `</div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
:root{--brand:#534AB7;--ink:#1e1b4b;--muted:#6b7280;--line:#e5e7eb;--bg:#f8f9fc}
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
    <h1>${escHtml(title)}</h1>
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
  ${findingItems ? `<div class="card">
    <h2>What needs to change or be added</h2>
    <ol>${findingItems}</ol>
  </div>` : ""}
  ${scopeRows ? `<div class="card">
    <h2>Scope</h2>
    <table>
      <thead><tr><th>Table</th><th>Role</th><th style="text-align:right">Rows</th><th style="text-align:right">Columns</th><th style="text-align:right">Duplicate rows</th><th>Blank columns</th></tr></thead>
      <tbody>${scopeRows}</tbody>
    </table>
  </div>` : ""}
  ${edgeRows ? `<div class="card">
    <h2>Relationships</h2>
    <div>${edgeRows}</div>
  </div>` : ""}
  <footer>Provenance: assembled deterministically from the review tool evidence. This report is read-only — re-run to regenerate from current data.</footer>
</div>
</body>
</html>`;
}

// ────────────────────────────────────────────────────────────────
// Spreadsheet backup — a .xlsx workbook assembled from the same review payload
// the HTML report uses: one sheet per reviewed table (concise sheet name, not
// the long data name) plus Verdicts + Variances summary sheets. `resolveRows`
// materializes a table's rows from the workspace by data name.

/** Concise, human-friendly sheet name from a table's menu label (shorter than
 *  the raw data name; strips the long shared prefixes the report scope uses). */
export function shortSheetName(label: string): string {
  const out = label
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^allocation\s+basis\s+tables?\s+/i, "")
    .replace(/^allocation\s+table\s+/i, "")
    .replace(/^net\s+intercompany\s+position\b/i, "Net position")
    .replace(/^exceptions\s+items\s+requiring\s+bookkeeper\s+action\b/i, "Exceptions")
    .replace(/^ic\s+/i, "IC ")
    .replace(/\s+by\s+entity\s+(?!pair\b)/i, " ");
  return out || label.trim() || "Sheet";
}

/** A lead "Instructions" sheet — the first tab explaining what the workbook is,
 *  how to read its tabs, and how the figures were produced. */
export function buildInstructionsSheet(): WorkbookSheet {
  return {
    name: "Instructions",
    columns: ["Section", "Detail"],
    rows: [
      {
        Section: "What is this?",
        Detail: "Backup spreadsheet for the data review. The HTML report is the primary deliverable; this workbook carries the underlying data tables plus the review's Verdicts and Variances for audit and tie-out.",
      },
      {
        Section: "Tabs",
        Detail: "One tab per reviewed table (data exactly as loaded), then \"Verdicts\" (per-category findings) and \"Variances\" (differences between two sources for the same entity).",
      },
      {
        Section: "Provenance",
        Detail: "Deterministic — every figure was read directly from the workspace data by the review tools; no AI wrote the numbers.",
      },
      {
        Section: "Snapshot",
        Detail: "Read-only snapshot. Re-run the analysis to regenerate from current data.",
      },
    ],
  };
}

export function buildReviewWorkbookSheets(
  review: ReviewPayload,
  resolveRows: (dataName: string) => Record<string, unknown>[] | null,
): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];

  for (const node of review.nodes ?? []) {
    const rows = resolveRows(node.id);
    if (!rows || rows.length === 0) continue;
    sheets.push({ name: shortSheetName(node.label || node.id), rows });
  }

  if ((review.verdicts ?? []).length > 0) {
    sheets.push({
      name: "Verdicts",
      rows: review.verdicts.map((v) => ({
        Category: v.category,
        Verdict: htmlVerdictLabel(v.severity),
        Summary: v.summary,
        Basis: v.basis,
      })),
    });
  }

  if ((review.variances ?? []).length > 0) {
    sheets.push({
      name: "Variances",
      rows: review.variances.map((v) => ({
        Key: v.key,
        Left: v.left,
        Right: v.right,
        Difference: v.diff,
      })),
    });
  }

  return sheets;
}

// ────────────────────────────────────────────────────────────────
// Remediation ("plan" beat) — the LLM proposes an ordered list of actions from
// the deterministic findings, each referencing the `verdict-*`/`var-*` refs it
// resolves. Read-only: actions are recommendations, not execution. A
// deterministic fallback runs when the LLM is unavailable.

import { llmCall } from "@backend/core/llm/llmCall";

export interface StoryAction {
  label: string;
  refs: string[];
}

const VALID_REF_RE = /^(verdict|var|node|edge)-\d+$/;

/** A plain-language digest of the findings the plan is proposed against. */
export function findingsDigest(review: ReviewPayload): string {
  const lines: string[] = [];
  for (const v of review.verdicts ?? []) {
    lines.push(`- [${v.ref}] ${v.category} (${v.severity.toFixed(2)}): ${v.summary} — ${v.basis}`);
  }
  for (const v of review.variances ?? []) {
    if (Math.abs(v.diff) > 1e-6) {
      lines.push(`- [${v.ref}] ${v.key}: left ${v.left} vs right ${v.right} (diff ${v.diff})`);
    }
  }
  for (const n of review.nodes ?? []) {
    if ((n.nullColNames?.length ?? 0) > 0) {
      lines.push(`- [${n.ref}] ${n.label}: blank fields ${n.nullColNames.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** Deterministic fallback (no LLM key): one action per non-green verdict and
 *  per variance, mapped to the review findings. */
export function deterministicPlan(review: ReviewPayload): StoryAction[] {
  const actions: StoryAction[] = [];
  for (const v of review.verdicts ?? []) {
    if (v.severity >= 0.3) {
      actions.push({ label: `Resolve "${v.category}" — ${v.summary}`, refs: [v.ref] });
    }
  }
  for (const v of review.variances ?? []) {
    if (Math.abs(v.diff) > 1e-6) {
      actions.push({
        label: `Investigate the variance for "${v.key}" (${v.diff > 0 ? "+" : ""}${v.diff})`,
        refs: [v.ref],
      });
    }
  }
  return actions;
}

export async function buildRemediationPlan(opts: {
  databaseId: string;
  review: ReviewPayload;
  rawMessage: string;
}): Promise<{ actions: StoryAction[]; unavailable?: boolean }> {
  const findings = findingsDigest(opts.review);
  if (!findings) return { actions: [] };

  const systemPrompt =
    "You are proposing a remediation plan for a data-review. The findings below were " +
    "produced deterministically (no LLM wrote them). Propose an ordered list of actions " +
    "that resolve the findings. Respond with JSON only: {\"actions\":[{\"label\":\"...\",\"refs\":[\"verdict-1\"]}]}. " +
    "Rules: (1) copy entity/account names VERBATIM from the findings — never invent or rename; " +
    "(2) do not introduce any numbers not derivable from the findings; " +
    "(3) each ref must be an existing ref listed in the findings; " +
    "(4) each action is a concrete recommendation (investigate, reclassify, reconcile, re-import, re-run) — you are NOT executing it, only proposing it; " +
    "(5) order actions by materiality (red/high severity first).";

  try {
    const result = await llmCall(opts.databaseId, "chat:story-plan", {
      systemPrompt,
      messages: [{ role: "user", content: `FINDINGS:\n${findings}` }],
      maxTokens: 800,
      temperature: 0,
      responseFormat: "json",
    });
    const data = (result.data ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(data.actions) ? (data.actions as unknown[]) : [];
    const actions: StoryAction[] = raw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map((a) => ({
        label: typeof a.label === "string" ? a.label : "",
        refs: Array.isArray(a.refs)
          ? (a.refs as unknown[]).filter((r): r is string => typeof r === "string" && VALID_REF_RE.test(r))
          : [],
      }))
      .filter((a) => a.label.trim().length > 0);
    if (actions.length === 0) return { actions: deterministicPlan(opts.review) };
    return { actions };
  } catch (err: any) {
    console.warn(`[vers_11] remediation plan failed (falling back to deterministic): ${err.message}`);
    return { actions: deterministicPlan(opts.review), unavailable: true };
  }
}

// ────────────────────────────────────────────────────────────────
// Sheet naming — an LLM proposes concise worksheet names (31 chars or fewer) for
// the workbook's already-shortened table labels, with a deterministic fallback
// to the labels themselves. Naming is generative, so the LLM is the right tool;
// it never writes figures, only renames tabs.

export async function nameWorkbookSheets(
  databaseId: string,
  labels: string[],
): Promise<string[]> {
  if (labels.length === 0) return [];

  const systemPrompt =
    "You are naming Excel worksheet tabs for a data-analysis workbook. " +
    "Given a list of table labels (already shortened from raw data names), return " +
    "concise, human-readable sheet names: 31 characters or fewer each, title case, " +
    "no underscores, no trailing punctuation. Keep entity/company names verbatim where " +
    "they appear. Respond with JSON only: {\"names\":[\"<name>\", ...]} with exactly one " +
    "entry per input label, in order.";

  try {
    const result = await llmCall(databaseId, "chat:story-plan", {
      systemPrompt,
      messages: [{ role: "user", content: labels.map((l, i) => `${i + 1}. ${l}`).join("\n") }],
      maxTokens: 400,
      temperature: 0,
      responseFormat: "json",
    });
    const data = (result.data ?? {}) as Record<string, unknown>;
    const names = Array.isArray(data.names) ? (data.names as unknown[]) : [];
    return labels.map((label, i) => {
      const n = names[i];
      return typeof n === "string" && n.trim() ? n.trim().slice(0, 31) : label;
    });
  } catch (err: any) {
    console.warn(`[vers_11] sheet naming failed (falling back to labels): ${err.message}`);
    return labels;
  }
}

