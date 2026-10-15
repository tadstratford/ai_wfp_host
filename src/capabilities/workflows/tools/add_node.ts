import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "add_node",
  description: "Adds a step (node) to a workflow. Nodes execute in step_order sequence.",
  class: "control",
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID"),
    label: z.string().describe("Human-readable step name"),
    tool_id: z.string().describe("Tool to execute (e.g. 'run_MCP', 'workflow_start', a native or MCP tool id)"),
    tool_parameters: z.string().optional().default("{}").describe("JSON object of tool parameters. Values may use {{variable}} references."),
    step_order: z.number().optional().describe("Execution order (auto-assigned to end if omitted)"),
  },
  handler: async ({ workflow_id, label, tool_id, tool_parameters, step_order }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(tool_parameters); } catch {
      return { content: [{ type: "text" as const, text: "Invalid JSON for tool_parameters." }], isError: true };
    }
    const nodes = [...wf.nodes];
    const order = step_order ?? (nodes.length > 0 ? Math.max(...nodes.map((n) => n.step_order)) + 1 : 1);
    const nodeId = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    nodes.push({ id: nodeId, type: "tool", label, tool_id, tool_parameters: params, step_order: order });
    ws.upsertWorkflow({ ...wf, nodes, updated_at: new Date().toISOString() } as any);
    return { content: [{ type: "text" as const, text: `Node "${label}" (${nodeId}) added to "${wf.name}" at step ${order}.` }] };
  },
});
