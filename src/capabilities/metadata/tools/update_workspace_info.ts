import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "update_workspace_info",
  description: "Updates workspace metadata fields. Only include the fields you want to change.",
  class: "control",
  inputSchema: {
    workspace: z.string().optional().describe("Workspace display name"),
    period: z.string().optional().describe("Period label (e.g. 'April 2026', 'FY2026 Q1')"),
  },
  handler: async ({ workspace, period }) => {
    const ws = requireWs();
    const patch: Record<string, unknown> = {};
    if (workspace !== undefined) patch.workspace = workspace;
    if (period !== undefined) patch.period = period;
    ws.updateMetadata(patch as any);
    return { content: [{ type: "text" as const, text: "Workspace metadata updated." }] };
  },
});
