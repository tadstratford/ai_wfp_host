import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "get_workspace_info",
  description: "Gets workspace metadata: name, period, format version, exported date.",
  class: "read",
  handler: async () => {
    const ws = requireWs();
    const meta = ws.getMetadata();
    return { content: [{ type: "text" as const, text: JSON.stringify(meta, null, 2) }] };
  },
});
