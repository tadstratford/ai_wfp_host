import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { Tool, Workflow } from "wfp-format";

/**
 * Imports a workflow (from another .wfp file) into the active workspace, along
 * with the custom tools its nodes reference. Semantics:
 *
 *   - If a workflow with the same `id` already exists → nothing is copied.
 *   - Otherwise the workflow is copied as-is (id + nodes preserved); if its
 *     `name` is already used it is suffixed "(2)", "(3)", …
 *   - Referenced custom tools are added only when their `tool_id` is not already
 *     present (target wins). Builtin tools never appear in the source tool list,
 *     so they are naturally skipped.
 *
 * Only the workflow and tools are touched — sessions, metadata, plan, todos,
 * data, and knowledge are left alone.
 */
export type ImportWorkflowResult =
  | { kind: "added"; workflowId: string; name: string }
  | { kind: "exists"; workflowId: string; name: string };

export function importWorkflowFromFile(
  databaseId: string,
  sourceWorkflow: Workflow,
  sourceTools: Tool[],
): ImportWorkflowResult {
  const session = requireSessionByDatabaseId(databaseId);

  const existing = session.getWorkflows();
  if (existing.some((w) => w.id === sourceWorkflow.id)) {
    return { kind: "exists", workflowId: sourceWorkflow.id, name: sourceWorkflow.name };
  }

  // Deduplicate the name — append (2), (3), … if it is already used.
  const usedNames = new Set(existing.map((w) => w.name));
  let name = sourceWorkflow.name;
  if (usedNames.has(name)) {
    let suffix = 2;
    while (usedNames.has(`${name} (${suffix})`)) suffix++;
    name = `${name} (${suffix})`;
  }

  const clone: Workflow = structuredClone(sourceWorkflow);
  clone.name = name;
  clone.updated_at = new Date().toISOString();
  if (!clone.created_at) clone.created_at = clone.updated_at;

  session.upsertWorkflow(clone);

  // Bring along the custom tools this workflow's nodes reference (target wins).
  const targetToolIds = new Set(session.getTools().map((t) => t.tool_id));
  const referencedIds = new Set(
    (sourceWorkflow.nodes ?? []).map((n) => n.tool_id).filter(Boolean),
  );
  for (const tool of sourceTools) {
    if (referencedIds.has(tool.tool_id) && !targetToolIds.has(tool.tool_id)) {
      session.upsertTool(tool);
      targetToolIds.add(tool.tool_id);
    }
  }

  return { kind: "added", workflowId: clone.id, name: clone.name };
}
