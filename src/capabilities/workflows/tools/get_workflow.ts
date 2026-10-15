import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "get_workflow",
  description: "Gets the full workflow definition including all nodes with their tool parameters.",
  class: "read",
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
  },
  handler: async ({ workflow_id }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(wf, null, 2) }] };
  },
});
