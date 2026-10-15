import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "update_workflow",
  description: "Updates a workflow's name or description.",
  class: "control",
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
    name: z.string().optional().describe("New workflow name"),
    description: z.string().optional().describe("New markdown description"),
  },
  handler: async ({ workflow_id, name, description }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    if (name !== undefined) (wf as any).name = name;
    if (description !== undefined) (wf as any).description = description;
    (wf as any).updated_at = new Date().toISOString();
    ws.upsertWorkflow(wf);
    return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" updated.` }] };
  },
});
