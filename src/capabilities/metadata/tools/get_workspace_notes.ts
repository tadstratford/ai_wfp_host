import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "get_workspace_notes",
  description: "Gets workspace-level notes (free-text annotations).",
  class: "read",
  handler: async () => {
    const ws = requireWs();
    const meta = ws.getMetadata();
    return { content: [{ type: "text" as const, text: JSON.stringify(meta.notes ?? [], null, 2) }] };
  },
});
