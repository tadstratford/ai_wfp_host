import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "delete_workflow",
  description: "Deletes a workflow from the workspace.",
  class: "destructive-write",
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID to delete"),
  },
  handler: async ({ workflow_id }) => {
    const ws = requireWs();
    const deleted = ws.deleteWorkflow(workflow_id);
    if (!deleted) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }] };
    }
    return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" deleted.` }] };
  },
});
