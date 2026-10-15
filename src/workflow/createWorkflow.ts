import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { shortId } from "@backend/utilities/shortId";
import { Workflow, WorkflowNode } from "@backend/types";

export const createWorkflow = async (
  databaseId: string,
  requestedName: string,
  description: string,
  type: "chat" | "automation" = "automation",
  group?: string,
): Promise<Workflow | null> => {
  try {
    const session = requireSessionByDatabaseId(databaseId);
    const existing = session.getWorkflows();
    const usedNames = new Set(existing.map((w) => w.name));

    // Deduplicate name — append (2), (3), etc. if name already exists
    let name = requestedName;
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${name} (${suffix})`)) suffix++;
      name = `${name} (${suffix})`;
    }

    const workflow_id = "wf-" + shortId();
    const nowIso = new Date().toISOString();

    const startNode: WorkflowNode = {
      id: "node-" + shortId(),
      type: "start",
      label: "Start",
      step_order: 1,
      tool_id: "workflow_start",
      tool_config: {},
      tool_parameters: {},
    };

    const wf: Workflow = {
      id: workflow_id,
      name,
      description,
      type,
      nodes: [startNode],
      created_at: nowIso,
      updated_at: nowIso,
      ...(group ? { group } : {}),
    };

    session.upsertWorkflow(wf);
    return wf;
  } catch (error) {
    console.error("Error creating workflow:", error);
    return null;
  }
};
