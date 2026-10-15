import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "list_workflows",
  description: "Lists all workflows in the workspace with name, type, node count, and timestamps.",
  class: "read",
  handler: async () => {
    const ws = requireWs();
    const workflows = ws.getWorkflows().map((w) => ({
      id: w.id,
      name: w.name,
      description: (w.description || "").slice(0, 200),
      type: w.type || "automation",
      node_count: w.nodes?.length ?? 0,
      created_at: (w as any).created_at,
      updated_at: (w as any).updated_at,
    }));
    const text = workflows.length === 0
      ? "No workflows in this workspace."
      : JSON.stringify(workflows, null, 2);
    return { content: [{ type: "text" as const, text }] };
  },
});
