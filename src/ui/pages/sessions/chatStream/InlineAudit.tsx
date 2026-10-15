import type { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import { generatePostMortem } from "@backend/core/process_manager/postMortem";
import type { User } from "@backend/types";

interface FactorAudit {
  condition: string;
  mode: string;
  result: "pass" | "fail";
  signal: string;
  remedy: string;
}

interface AuditJson {
  auditId: string;
  pack: string;
  packContentHash: string;
  subject: string;
  verdict: "pass" | "failed" | "needs_review";
  factors: FactorAudit[];
  summary: { total: number; passed: number; failed: number };
  model: string;
}

export function InlineAudit({
  audit,
  sessionId,
  postMortemHtml,
}: {
  audit: AuditJson;
  sessionId: string;
  postMortemHtml?: string;
}) {
  const failed = audit.verdict === "failed" || audit.verdict === "needs_review";
  const failedFactors = audit.factors.filter((f) => f.result === "fail");
  const bg = failed ? "#fef2f2" : "#f0fdf4";
  const borderCol = failed ? "#dc2626" : "#bbf7d0";
  return (
    <div style="margin:-16px;margin-top:0">
      <div style={`background:${bg};border-top:3px solid ${borderCol}`}>
        {/* Header */}
        <div style={`padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${failed ? "#fecaca" : "#bbf7d0"}`}>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">Machine Audit</span>
            <span style={`font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;${failed ? "background:#fee2e2;color:#dc2626" : "background:#dcfce7;color:#15803d"}`}>
              {failed ? "FAILED AUDIT" : "PASS"}
            </span>
          </div>
          <span style="font-size:12px;color:#6b7280">
            {audit.summary.total} factor{audit.summary.total === 1 ? "" : "s"}
          </span>
        </div>

        {/* Pack/subject info */}
        <div style="padding:8px 14px;font-size:12px;color:#374151;border-bottom:1px solid #e5e7eb">
          Pack <strong>{audit.pack}</strong> &middot; subject <strong>{audit.subject}</strong>
          {audit.summary.failed > 0 && (
            <span> &middot; <span style="color:#dc2626;font-weight:600">{audit.summary.failed} failed</span></span>
          )}
        </div>

        {/* Failed factors */}
        {failedFactors.length > 0 && (
          <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
            {failedFactors.map((f, i) => (
              <div key={i} style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #f3f4f6;font-size:13px">
                <div style="font-weight:600;color:#dc2626;margin-bottom:2px">{f.condition} <span style="font-weight:400;color:#6b7280;font-size:11px">[{f.mode}]</span></div>
                <div style="color:#4b5563;margin-top:4px"><span style="font-weight:500">Signal:</span> {f.signal}</div>
                <div style="color:#4b5563;margin-top:2px"><span style="font-weight:500">Remedy:</span> {f.remedy}</div>
              </div>
            ))}
          </div>
        )}

        {/* Analyze button or post-mortem */}
        <div class="audit-analyze" style="padding:10px 14px">
          {postMortemHtml ? (
            <div dangerouslySetInnerHTML={{ __html: postMortemHtml }} />
          ) : (
            <>
              <button
                class="audit-analyze-btn"
                hx-post={`/sessions/api/post-mortem?auditId=${audit.auditId}&sessionId=${sessionId}`}
                hx-target="closest .audit-analyze"
                hx-swap="innerHTML"
                style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer;background:#3E8DE1;color:#fff"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.376 3.622a1 1 0 013.002 3.002L7.368 18.635a2 2 0 01-.855.506l-2.872.838a.5.5 0 01-.62-.62l.838-2.872a2 2 0 01.506-.854z" />
                </svg>
                Generate 360° Analysis
              </button>
              <span class="htmx-indicator" style="margin-left:8px;font-size:13px;color:#6b7280">Generating...</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * POST handler for post-mortem generation — returns HTML partial
 */
export const postMortemHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const auditId = c.req.query("auditId") || "";
  const sessionId = c.req.query("sessionId") || "";

  if (!databaseId || !auditId || !sessionId) {
    return c.html(<div class="text-sm text-coral-600">Missing parameters</div>);
  }

  try {
    await generatePostMortem(databaseId, auditId, sessionId);
    const s = await getSession(databaseId, sessionId);
    const pm = (s?.messages || []).find(
      (m: any) => m?.json?.postMortem === true && m?.json?.auditId === auditId,
    );
    if (pm?.html) {
      return c.html(<div dangerouslySetInnerHTML={{ __html: pm.html }} />);
    }
    return c.html(<div class="text-sm text-leaf-600">Analysis complete.</div>);
  } catch (err: any) {
    return c.html(<div class="text-sm text-coral-600">Error: {err.message}</div>);
  }
};
