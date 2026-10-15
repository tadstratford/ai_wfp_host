import { v4 as uuidv4 } from "uuid";
import { requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getWorkflowById } from "./getWorkflowbyId";
import { createWorkflow } from "./createWorkflow";
import type { WorkflowNode } from "@backend/types";

/**
 * Copies an existing workflow to a new one with a new name.
 */
export const copyWorkflow = async (
  databaseId: string,
  sourceWorkflowId: string,
  newName: string,
  description?: string,
): Promise<string | null> => {
  try {
    const sourceWorkflow = await getWorkflowById(databaseId, sourceWorkflowId);
    if (!sourceWorkflow) {
      console.error(`Source workflow ${sourceWorkflowId} not found`);
      return null;
    }

    const newWorkflow = await createWorkflow(
      databaseId,
      newName,
      description || sourceWorkflow.description || "",
      sourceWorkflow.type || "automation",
    );
    if (!newWorkflow) {
      console.error("Failed to create new workflow record");
      return null;
    }

    // Clone every node with a fresh id.
    const newNodes: WorkflowNode[] = sourceWorkflow.nodes.map((node) => {
      const clone: WorkflowNode = JSON.parse(JSON.stringify(node));
      clone.id = "node-" + uuidv4();
      return clone;
    });

    const session = requireSessionByDatabaseId(databaseId);
    session.upsertWorkflow({
      ...newWorkflow,
      nodes: newNodes,
      // Inherit the source's nav group so the copy lands in the same section.
      group: sourceWorkflow.group,
      updated_at: new Date().toISOString(),
    });

    console.log(`Workflow copied successfully: ${sourceWorkflowId} -> ${newWorkflow.id}`);
    return newWorkflow.id;
  } catch (error) {
    console.error("Error copying workflow:", error);
    return null;
  }
};
