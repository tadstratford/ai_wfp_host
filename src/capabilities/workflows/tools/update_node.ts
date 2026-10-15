import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "update_node",
  description: "Updates a node's label or tool parameters in a workflow.",
  class: "control",
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
    node_id: z.string().describe("Node ID to update"),
    label: z.string().optional().describe("New step label"),
    tool_parameters: z.string().optional().describe("JSON object of new tool parameters (replaces existing)"),
  },
  handler: async ({ workflow_id, node_id, label, tool_parameters }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    const idx = wf.nodes.findIndex((n: any) => n.id === node_id);
    if (idx === -1) {
      return { content: [{ type: "text" as const, text: `Node "${node_id}" not found.` }], isError: true };
    }
    const nodes = [...wf.nodes];
    if (label !== undefined) nodes[idx] = { ...nodes[idx], label } as any;
    if (tool_parameters !== undefined) {
      try {
        nodes[idx] = { ...nodes[idx], tool_parameters: JSON.parse(tool_parameters) } as any;
      } catch {
        return { content: [{ type: "text" as const, text: "Invalid JSON for tool_parameters." }], isError: true };
      }
    }
    ws.upsertWorkflow({ ...wf, nodes, updated_at: new Date().toISOString() } as any);
    return { content: [{ type: "text" as const, text: `Node "${node_id}" updated.` }] };
  },
});
