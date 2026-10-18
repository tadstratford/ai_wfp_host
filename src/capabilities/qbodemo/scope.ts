import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";

/**
 * qbodemo scope — minimal workspace scoping for the demo QBO capability.
 * Unlike the live `qbo` capability there is no OAuth, no token vault, and no
 * "not connected" state: the demo company is always available to read/write.
 */

let currentDatabaseId: string | null = null;

export function setScope(id: string) {
  currentDatabaseId = id;
}

export function getDatabaseId(): string | null {
  return currentDatabaseId;
}

export function requireWs(): WorkspaceSession {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  const ws = getSessionByDatabaseId(currentDatabaseId);
  if (!ws) throw new Error("No active workspace.");
  return ws;
}

/** Persist a flat array into the workspace data map (used by `store_to`). */
export function writeDataEntry(
  ws: WorkspaceSession,
  name: string,
  arr: unknown[],
  columns: string[],
): void {
  ws.setDataEntry(name, {
    content: JSON.stringify(arr),
    content_type: "json_array",
    content_json: arr,
    columns,
    row_count: arr.length,
    edited_at: new Date().toISOString(),
  });
}

/** Expand a calendar date range into month boundaries: [{ period, start, end }]. */
export function monthRange(
  startDate: string,
  endDate: string,
): { period: string; start: string; end: string }[] {
  const [sy, sm] = startDate.split("-").map(Number);
  const [ey, em] = endDate.split("-").map(Number);
  const out: { period: string; start: string; end: string }[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const period = `${y}-${String(m).padStart(2, "0")}`;
    const lastDay = new Date(y, m, 0).getDate();
    out.push({ period, start: `${period}-01`, end: `${period}-${String(lastDay).padStart(2, "0")}` });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
