import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "create_workflow",
  description: "Creates a new workflow in the workspace.",
  class: "control",
  durable: true,
  inputSchema: {
    name: z.string().describe("Workflow name (unique within the workspace)"),
    description: z.string().optional().default("").describe("Markdown description"),
    type: z.enum(["automation", "chat"]).optional().default("automation").describe("Workflow type"),
  },
  handler: async ({ name, description, type }) => {
    const ws = requireWs();
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    ws.upsertWorkflow({
      id,
      name,
      description: description || "",
      type,
      nodes: [],
      created_at: now,
      updated_at: now,
    } as any);
    return { content: [{ type: "text" as const, text: `Workflow "${name}" created (${id}).` }] };
  },
});
