import { Context } from "hono";
import type { User } from "@backend/types";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { workspacePageView } from "./workspacePanel";

/**
 * Group-level workflow actions.
 *
 * Reset: marks every workflow in a named group as ready-to-run again. Backs the
 * "Reset" button on each group header in the Workflows section of /app/overview.
 *
 * Reorder: swaps a workflow's sort_order with its neighbour within the same
 * group. Backs the "Move up" / "Move down" items in each workflow's ⋮ menu.
 *
 * Both are deterministic; no LLM; both refresh the page so the board reflects
 * the new state immediately.
 */

// ── POST /app/workflow-group/reset ───────────────────────────────────────────

export const workflowGroupResetHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const body = await c.req.parseBody();
    const group = String(body.group ?? "").trim();
    if (!group) return c.text("Missing group", 400);

    const [
      { getWorkflowIdsInGroup },
      { resetWorkflowStatus },
    ] = await Promise.all([
      import("@backend/core/overview/workflowGroups"),
      import("@backend/core/workspace/workflowStatus"),
    ]);

    const ids = getWorkflowIdsInGroup(databaseId, group);
    let n = 0;
    for (const id of ids) {
      if (resetWorkflowStatus(databaseId, id)) n++;
    }
    if (n > 0) notifyClients("global", "workflow_update");
    return workspacePageView(c);
  } catch (err: any) {
    console.error("[workflow-group reset]", err);
    return c.text("Error: " + err.message, 500);
  }
};

// ── POST /app/workflow/:id/reorder ───────────────────────────────────────────

interface WfLite { id: string; name: string; sort_order?: number; group?: string; created_at?: string }

export const workflowReorderHandler = async (c: Context) => {
  try {
    const user = c.get("user") as User;
    const databaseId = user.currentDatabaseId;
    if (!databaseId) return c.text("");

    const workflowId = c.req.param("workflowId");
    const body = await c.req.parseBody();
    const direction = String(body.direction ?? "").trim();
    if (direction !== "up" && direction !== "down") {
      return c.text("direction must be 'up' or 'down'", 400);
    }

    const { requireSessionByDatabaseId } = await import(
      "@backend/core/workspace/workspaceSessionStore"
    );
    const ws = requireSessionByDatabaseId(databaseId);
    const target = ws.getWorkflow(workflowId);
    if (!target) return c.text("Workflow not found", 404);

    const targetGroup = target.group?.trim() || "(Ungrouped)";
    const all = ws.getWorkflows().slice() as WfLite[];
    // Same group, sorted by sort_order (stable, default 999) then name.
    // MUST match `getWorkflowGroups` in workflowGroups.ts — otherwise the
    // user-visible order and the handler's peer order disagree on tie-breakers
    // and Move buttons hit the wrong boundary.
    const peers = all
      .filter((w) => (w.group?.trim() || "(Ungrouped)") === targetGroup)
      .sort(
        (a, b) =>
          (a.sort_order ?? 999) - (b.sort_order ?? 999) ||
          a.name.localeCompare(b.name),
      );

    const idx = peers.findIndex((w) => w.id === workflowId);
    if (idx === -1) return c.text("Not in any group", 400);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= peers.length) return c.text(""); // at boundary — UI disables

    const a = peers[idx];
    const b = peers[swapIdx];
    // Assign each workflow an explicit sort_order matching its NEW position in
    // the peers list. This works even when both rows were tied at the default
    // (999) — a naive swap of equal values would leave them still tied and the
    // panel's tie-breaker (created_at) would keep the old visual order.
    const now = new Date().toISOString();
    ws.upsertWorkflow({ ...ws.getWorkflow(a.id)!, sort_order: swapIdx, updated_at: now });
    ws.upsertWorkflow({ ...ws.getWorkflow(b.id)!, sort_order: idx, updated_at: now });

    notifyClients("global", "workflow_update");
    return workspacePageView(c);
  } catch (err: any) {
    console.error("[workflow reorder]", err);
    return c.text("Error: " + err.message, 500);
  }
};
