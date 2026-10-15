/**
 * Audit log — Glass Box slice 4 (see docs/glass-box-spec.md)
 *
 * Gathers every machine-audit verdict recorded in the workspace's run logs
 * (message.json.successFactorAudit) so the Exceptions view can surface the
 * NEEDS-REVIEW items first — the "exception orbit": a clean close shows nothing.
 *
 * Reads only what slice 2 already recorded; nothing is recomputed.
 */

import { getAllSessions } from "@backend/core/session/sessions/session_all";

export interface AuditVerdictSummary {
  auditId: string;
  sessionId: string;
  pack: string;
  subject: string;
  verdict: "pass" | "failed";
  total: number;
  passed: number;
  failed: number;
  model: string;
  /** GL journal header ids this verdict covers (set by an in-run GL audit). */
  auditedHeaderIds?: string[];
  /** Message time in ms (0 if unknown) — used for ordering. */
  timestamp: number;
}

function toMs(t: unknown): number {
  if (!t) return 0;
  const d = t instanceof Date ? t : new Date(t as any);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Pure extraction: pull verdicts out of a list of sessions and order them
 * NEEDS-REVIEW first, then newest first. Testable without any session infra.
 */
export function extractVerdicts(
  sessions: Array<{ session_id: string; messages?: Array<any> }>,
): AuditVerdictSummary[] {
  const out: AuditVerdictSummary[] = [];
  for (const s of sessions) {
    for (const m of s.messages ?? []) {
      const a = m?.json?.workflowAudit ?? m?.json?.successFactorAudit;
      if (!a || !a.auditId) continue;
      out.push({
        auditId: a.auditId,
        sessionId: s.session_id,
        pack: a.pack ?? "",
        subject: a.subject ?? "",
        verdict:
          a.statusReason != null
            ? a.statusReason === "no_errors"
              ? "pass"
              : "failed"
            : a.verdict === "failed"
              ? "failed"
              : "pass",
        total: a.summary?.total ?? 0,
        passed: a.summary?.passed ?? 0,
        failed: a.summary?.failed ?? 0,
        model: a.model ?? "",
        auditedHeaderIds: Array.isArray(a.auditedHeaderIds) ? a.auditedHeaderIds : undefined,
        timestamp: toMs(m.timestamp),
      });
    }
  }
  out.sort((x, y) => {
    if (x.verdict !== y.verdict) return x.verdict === "failed" ? -1 : 1;
    return y.timestamp - x.timestamp;
  });
  return out;
}

/** All recorded audit verdicts in the active workspace, NEEDS-REVIEW first. */
export async function listAuditVerdicts(databaseId: string): Promise<AuditVerdictSummary[]> {
  const sessions = await getAllSessions(databaseId);
  return extractVerdicts(sessions as any);
}

/**
 * Pick the verdict for a journal entry from a list. Prefers an explicit
 * `auditedHeaderIds` match (an in-run GL audit names the entries it covered);
 * falls back to the entry's `source_session_id` (the run that posted it). Pure.
 */
export function pickVerdictForJournal(
  all: AuditVerdictSummary[],
  header: { id: string; source_session_id?: string | null },
): AuditVerdictSummary | null {
  const byHeader = all.find((v) => v.auditedHeaderIds?.includes(header.id));
  if (byHeader) return byHeader;
  if (header.source_session_id) {
    return all.find((v) => v.sessionId === header.source_session_id) ?? null;
  }
  return null;
}

/** The recorded verdict for a journal entry in the active workspace, if any. */
export async function findVerdictForJournal(
  databaseId: string,
  header: { id: string; source_session_id?: string | null },
): Promise<AuditVerdictSummary | null> {
  return pickVerdictForJournal(await listAuditVerdicts(databaseId), header);
}

/**
 * Quick check: does a given session have a recorded verdict?
 * Returns the verdict summary, or null if no audit exists.
 * Pure function — works with a pre-loaded list.
 */
export function findVerdictBySessionId(
  verdicts: AuditVerdictSummary[],
  sessionId: string,
): AuditVerdictSummary | null {
  return verdicts.find((v) => v.sessionId === sessionId) ?? null;
}

/**
 * Async version: load all verdicts and check one session.
 */
export async function getSessionVerdict(
  databaseId: string,
  sessionId: string,
): Promise<AuditVerdictSummary | null> {
  const verdicts = await listAuditVerdicts(databaseId);
  return findVerdictBySessionId(verdicts, sessionId);
}
