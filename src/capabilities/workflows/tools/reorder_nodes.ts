import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "reorder_nodes",
  description: "Reorders workflow nodes by providing a list of node IDs in the desired order.",
  class: "control",
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
    node_ids: z.string().describe("JSON array of node IDs in the desired order (e.g. '[\"n1\",\"n2\",\"n3\"]')"),
  },
  handler: async ({ workflow_id, node_ids }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    let order: string[];
    try { order = JSON.parse(node_ids); } catch {
      return { content: [{ type: "text" as const, text: "Invalid JSON array for node_ids." }], isError: true };
    }
    if (!Array.isArray(order)) {
      return { content: [{ type: "text" as const, text: "node_ids must be a JSON array." }], isError: true };
    }
    const nodeMap = new Map(wf.nodes.map((n: any) => [n.id, n]));
    const reordered: any[] = [];
    for (let i = 0; i < order.length; i++) {
      const n = nodeMap.get(order[i]);
      if (!n) return { content: [{ type: "text" as const, text: `Node "${order[i]}" not found.` }], isError: true };
      reordered.push({ ...n, step_order: i + 1 });
    }
    ws.upsertWorkflow({ ...wf, nodes: reordered, updated_at: new Date().toISOString() } as any);
    return { content: [{ type: "text" as const, text: `Nodes reordered (${reordered.length} steps).` }] };
  },
});
