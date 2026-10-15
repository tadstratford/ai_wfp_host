import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "delete_node",
  description: "Removes a node from a workflow. Remaining nodes are renumbered.",
  class: "destructive-write",
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
    node_id: z.string().describe("Node ID to delete"),
  },
  handler: async ({ workflow_id, node_id }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    const filtered = wf.nodes.filter((n: any) => n.id !== node_id);
    if (filtered.length === wf.nodes.length) {
      return { content: [{ type: "text" as const, text: `Node "${node_id}" not found.` }] };
    }
    filtered.forEach((n: any, i: number) => { n.step_order = i + 1; });
    ws.upsertWorkflow({ ...wf, nodes: filtered, updated_at: new Date().toISOString() } as any);
    return { content: [{ type: "text" as const, text: `Node "${node_id}" deleted. Nodes renumbered.` }] };
  },
});
