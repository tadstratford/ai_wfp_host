/**
 * InlineReview — visual-first data-review card rendered from a `kind: "review"`
 * message's `json.review` payload (produced deterministically by the vers_9
 * orchestrator). Shows a relationship map, a variance strip, and colored verdict
 * cards up top, with the raw scope/facts receipts collapsed behind a <details>.
 *
 * The map is server-rendered inline SVG. Nodes are clickable (they anchor to the
 * "Table details" list below) and every node/edge carries a native <title>
 * tooltip with the full name and figures.
 */

interface ReviewNode {
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

interface ReviewEdge {
  from: string;
  to: string;
  ref: string;
  keyCol: string;
  kind: string;
  status: "tie" | "variance" | "partial" | "unknown";
  label: string;
  detail: string;
}

interface ReviewVariance {
  key: string;
  left: number;
  right: number;
  diff: number;
  ref: string;
}

interface ReviewVerdict {
  category: string;
  severity: number;
  summary: string;
  basis: string;
  ref: string;
}

interface ReviewPayload {
  title: string;
  nodes: ReviewNode[];
  edges: ReviewEdge[];
  variances: ReviewVariance[];
  verdicts: ReviewVerdict[];
  narration?: string;
  notes?: string[];
}

function fmtMoney(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  return `${rounded < 0 ? "-" : ""}$${abs.toLocaleString("en-US")}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const ROLE_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  ledger: { fill: "#eef2ff", stroke: "#6366f1", label: "Ledger" },
  report: { fill: "#f0fdf4", stroke: "#16a34a", label: "Report" },
  worklist: { fill: "#fff7ed", stroke: "#d97706", label: "Worklist" },
  summary: { fill: "#fdf2f8", stroke: "#db2777", label: "Summary" },
  reference: { fill: "#f8fafc", stroke: "#64748b", label: "Reference" },
  other: { fill: "#f3f4f6", stroke: "#94a3b8", label: "Other" },
};

const ROLE_ORDER = ["ledger", "report", "worklist", "summary", "reference", "other"];

const EDGE_COLORS: Record<string, string> = {
  variance: "#dc2626",
  tie: "#16a34a",
  partial: "#d97706",
  unknown: "#94a3b8",
};

/** Build the relationship-map SVG as an HTML string (avoids Hono JSX SVG typing
 *  quirks and keeps the layout math plain TypeScript). Only reconciled edges
 *  render; edge labels are drawn in a third pass so they sit on top of the node
 *  boxes (never hidden), and each edge label is clickable to append its detail. */
function buildMapSvg(review: ReviewPayload, sessionId?: string): string {
  const nodes = review.nodes ?? [];
  if (nodes.length === 0) return "";

  const W = 180;
  const H = 46;
  const colGap = 290;
  const rowGap = 74;
  const margin = 28;

  const pos = new Map<string, { x: number; y: number }>();
  const roleCursor = new Map<string, number>();
  let maxCol = 0;
  let maxRows = 0;
  for (const n of nodes) {
    const colIdx = Math.max(0, ROLE_ORDER.indexOf(n.role));
    const idx = roleCursor.get(n.role) ?? 0;
    roleCursor.set(n.role, idx + 1);
    pos.set(n.id, { x: margin + colIdx * colGap, y: margin + idx * rowGap });
    maxCol = Math.max(maxCol, colIdx);
    maxRows = Math.max(maxRows, idx + 1);
  }

  const width = margin * 2 + (maxCol + 1) * colGap;
  const height = margin * 2 + maxRows * rowGap;

  const reconciled = (review.edges ?? []).filter((e) => e.status !== "unknown");

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:100%;height:auto;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">`;

  // Pass 1 — edge paths (under the nodes).
  interface EdgeLabel { mx: number; my: number; short: string; col: string; ref: string; title: string; }
  const labels: EdgeLabel[] = [];
  for (const e of reconciled) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + W / 2;
    const y1 = a.y + H;
    const x2 = b.x + W / 2;
    const y2 = b.y;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dash = e.status === "partial" ? ' stroke-dasharray="4 3"' : "";
    const col = EDGE_COLORS[e.status] ?? "#16a34a";
    svg += `<path d="M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}" fill="none" stroke="${col}" stroke-width="1.8"${dash}/>`;

    let short: string;
    if (e.status === "variance" && e.kind === "aggregate") {
      const m = /\(([^)]*)\)/.exec(e.label);
      short = m ? m[1] : "differs";
    } else if (e.status === "tie") {
      short = "ties";
    } else {
      short = truncate(e.label.replace(/^[^·]*·\s*/, ""), 18);
    }
    labels.push({ mx, my, short, col, ref: e.ref, title: `${e.label}\n${e.detail ?? ""}` });
  }

  // Pass 2 — nodes (opaque, cover the edge paths).
  nodes.forEach((n, i) => {
    const p = pos.get(n.id);
    if (!p) return;
    const c = ROLE_COLORS[n.role] ?? ROLE_COLORS.other;
    const sub = `${n.rows} row${n.rows === 1 ? "" : "s"}${n.nullCols > 0 ? ` · ${n.nullCols} blank` : ""}`;
    const tooltip = [
      `${n.label}`,
      `${c.label} · ${n.rows} rows · ${n.columns} columns`,
      n.nullColNames.length > 0 ? `Blank: ${n.nullColNames.join(", ")}` : "No blank fields",
    ].join("\n");
    const post = sessionId
      ? `href="#detail-node-${i}" hx-post="/sessions/api/review-detail?sessionId=${sessionId}&ref=${n.ref}" hx-trigger="click" hx-swap="none"`
      : `href="#detail-node-${i}"`;
    svg += `<a ${post} style="cursor:pointer">`;
    svg += `<g><title>${escapeXml(tooltip)}</title>`;
    svg += `<rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>`;
    svg += `<text x="${p.x + W / 2}" y="${p.y + 19}" text-anchor="middle" font-size="12" font-weight="600" fill="#1e293b">${escapeXml(truncate(n.label, 24))}</text>`;
    svg += `<text x="${p.x + W / 2}" y="${p.y + 36}" text-anchor="middle" font-size="10.5" fill="#64748b">${escapeXml(sub)}</text>`;
    svg += `</g></a>`;
  });

  // Pass 3 — edge labels on top of the nodes, so they are never hidden.
  for (const L of labels) {
    const pillW = L.short.length * 6.1 + 10;
    const pillH = 17;
    const px = L.mx - pillW / 2;
    const py = L.my - pillH / 2;
    const post = sessionId
      ? `hx-post="/sessions/api/review-detail?sessionId=${sessionId}&ref=${L.ref}" hx-trigger="click" hx-swap="none"`
      : "";
    svg += `<a ${post} style="cursor:pointer"><g><title>${escapeXml(L.title)}</title>`;
    svg += `<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="8" fill="#ffffff" fill-opacity="0.96" stroke="${L.col}" stroke-width="1"/>`;
    svg += `<text x="${L.mx}" y="${L.my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${L.col === "#94a3b8" ? "#475569" : L.col}">${escapeXml(L.short)}</text></g></a>`;
  }

  svg += `</svg>`;
  return svg;
}

function verdictColor(severity: number): { bg: string; fg: string; border: string } {
  if (severity >= 0.6) return { bg: "#fef2f2", fg: "#dc2626", border: "#fecaca" };
  if (severity >= 0.3) return { bg: "#fffbeb", fg: "#d97706", border: "#fde68a" };
  return { bg: "#f0fdf4", fg: "#16a34a", border: "#bbf7d0" };
}

export function InlineReview({
  review,
  receiptsHtml,
  bucket,
  sessionId,
}: {
  review: ReviewPayload;
  receiptsHtml?: string;
  bucket?: "setup" | "status" | "gap";
  sessionId?: string;
}) {
  const showAll = !bucket;
  const mapSvg = buildMapSvg(review, sessionId);
  const variances = review.variances ?? [];
  const maxVariance = Math.max(1, ...variances.map((v) => Math.max(Math.abs(v.left), Math.abs(v.right))));
  const issues = review.verdicts.filter((v) => v.severity >= 0.6);
  const beatLabel =
    bucket === "setup" ? "Setup — what the data looks like" :
    bucket === "status" ? "Status — is the data correct?" :
    bucket === "gap" ? "Gap — what needs to change" :
    undefined;

  return (
    <div style="margin:-16px;margin-top:0">
      <div style="border-top:3px solid #3E8DE1;background:#ffffff">
        {/* Header */}
        <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb">
          <span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">
            {beatLabel || review.title}
          </span>
          {review.nodes.length > 0 && (
            <span style="font-size:12px;color:#6b7280">
              {review.nodes.length} table{review.nodes.length === 1 ? "" : "s"}
              {review.edges.length > 0 ? ` · ${review.edges.length} link${review.edges.length === 1 ? "" : "s"}` : ""}
            </span>
          )}
        </div>

        {/* Relationship map */}
        {(showAll || bucket === "setup") && mapSvg && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px">
              How the data connects
            </div>
            <div dangerouslySetInnerHTML={{ __html: mapSvg }} />
            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;font-size:11px;color:#64748b">
              {Object.entries(ROLE_COLORS).map(([role, c]) => (
                <span style="display:inline-flex;align-items:center;gap:4px">
                  <span style={`display:inline-block;width:10px;height:10px;border-radius:3px;background:${c.fill};border:1px solid ${c.stroke}`}></span>
                  {c.label}
                </span>
              ))}
              <span style="display:inline-flex;align-items:center;gap:4px">
                <span style="display:inline-block;width:10px;height:4px;border-radius:2px;background:#dc2626"></span>
                differs
              </span>
              <span style="display:inline-flex;align-items:center;gap:4px">
                <span style="display:inline-block;width:10px;height:4px;border-radius:2px;background:#16a34a"></span>
                ties
              </span>
              <span style="display:inline-flex;align-items:center;gap:4px;margin-left:auto">Click a box for details</span>
            </div>
          </div>
        )}

        {/* Variance strip */}
        {(showAll || bucket === "status") && variances.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px">
              Ledger vs report
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              {variances.map((v) => {
                const red = Math.abs(v.diff) > 1e-6;
                const lw = (Math.abs(v.left) / maxVariance) * 100;
                const rw = (Math.abs(v.right) / maxVariance) * 100;
                return (
                  <div
                    style="font-size:12px;color:#374151;cursor:pointer"
                    title="Click for detail"
                    data-ref={v.ref}
                    hx-post={`/sessions/api/review-detail?sessionId=${sessionId ?? ""}&ref=${v.ref}`}
                    hx-swap="none"
                  >
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
                      <span style="font-weight:600">{v.key}</span>
                      <span style={`font-weight:600;${red ? "color:#dc2626" : "color:#16a34a"}`}>
                        {red ? `${v.diff > 0 ? "+" : ""}${fmtMoney(v.diff)}` : "ties"}
                      </span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div style="flex:1;display:flex;gap:4px">
                        <div style={`height:8px;border-radius:4px;background:#6366f1;width:${Math.max(2, lw)}%`}></div>
                        <div style={`height:8px;border-radius:4px;background:#16a34a;width:${Math.max(2, rw)}%`}></div>
                      </div>
                      <span style="font-size:11px;color:#64748b;white-space:nowrap">
                        {fmtMoney(v.left)} → {fmtMoney(v.right)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Verdict cards */}
        {(showAll || bucket === "status") && review.verdicts.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">
              {review.verdicts.map((v) => {
                const c = verdictColor(v.severity);
                return (
                  <div
                    title={v.basis}
                    data-ref={v.ref}
                    style={`padding:8px 10px;border:1px solid ${c.border};border-radius:8px;background:${c.bg};cursor:pointer`}
                    hx-post={`/sessions/api/review-detail?sessionId=${sessionId ?? ""}&ref=${v.ref}`}
                    hx-swap="none"
                  >
                    <div style="display:flex;align-items:center;gap:6px">
                      <span style={`display:inline-block;width:8px;height:8px;border-radius:999px;background:${c.fg}`}></span>
                      <span style="font-size:12px;font-weight:600;color:#1f2937">{v.category}</span>
                    </div>
                    <div style={`font-size:12px;color:${c.fg};margin-top:3px`}>{v.summary}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Gap — the conflict, framed as action items */}
        {(showAll || bucket === "gap") && issues.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:8px">
              What needs to change or be added
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#374151">
              {issues.map((v) => {
                const c = verdictColor(v.severity);
                return (
                  <div
                    data-ref={v.ref}
                    style="display:flex;gap:8px;padding:6px 8px;border-radius:6px;background:#f9fafb;cursor:pointer"
                    title="Click for detail"
                    hx-post={`/sessions/api/review-detail?sessionId=${sessionId ?? ""}&ref=${v.ref}`}
                    hx-swap="none"
                  >
                    <span style={`display:inline-block;width:8px;height:8px;border-radius:999px;margin-top:5px;background:${c.fg}`}></span>
                    <span>
                      <strong>{v.category}</strong> — {v.summary}. <span style="color:#6b7280">{v.basis}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Narrator + review notes (optional, from the LLM critic) */}
        {(showAll || bucket === "status") && review.notes && review.notes.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #fecaca;background:#fff7f7">
            {review.notes.map((n, i) => (
              <div key={i} style="font-size:12.5px;color:#b91c1c;margin-bottom:4px">⚠ {n}</div>
            ))}
          </div>
        )}
        {(showAll || bucket === "status") && review.narration && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px">
              What this means
            </div>
            <div style="font-size:13px;color:#374151;line-height:1.5">{review.narration}</div>
          </div>
        )}

        {/* Table details — anchor targets for the clickable map nodes */}
        {(showAll || bucket === "setup") && review.nodes.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px">
              Table details
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#374151">
              {review.nodes.map((n, i) => {
                const c = ROLE_COLORS[n.role] ?? ROLE_COLORS.other;
                return (
                  <div
                    id={`detail-node-${i}`}
                    data-ref={n.ref}
                    style="display:flex;flex-wrap:wrap;gap:4px 8px;padding:4px 6px;border-radius:6px;cursor:pointer"
                    title="Click for detail"
                    hx-post={`/sessions/api/review-detail?sessionId=${sessionId ?? ""}&ref=${n.ref}`}
                    hx-swap="none"
                  >
                    <span style={`display:inline-block;width:8px;height:8px;border-radius:2px;margin-top:4px;background:${c.fill};border:1px solid ${c.stroke}`}></span>
                    <span style="font-weight:600">{n.label}</span>
                    <span style="color:#6b7280">{c.label}</span>
                    <span style="color:#6b7280">
                      {n.rows} rows · {n.columns} columns{n.dupRows > 0 ? ` · ${n.dupRows} dup` : ""}
                    </span>
                    {n.nullColNames.length > 0 && (
                      <span style="color:#dc2626">blank: {n.nullColNames.join(", ")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Raw receipts — collapsed */}
        {receiptsHtml && (showAll || bucket === "gap") && (
          <details style="padding:8px 14px">
            <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#6b7280">
              Raw receipts
            </summary>
            <div
              class="prose prose-sm prose-slate dark:prose-invert max-w-none"
              style="margin-top:6px;color:#374151"
              dangerouslySetInnerHTML={{ __html: receiptsHtml }}
            />
          </details>
        )}
      </div>
    </div>
  );
}
