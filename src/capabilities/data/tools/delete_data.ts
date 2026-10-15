import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "delete_data",
  description: "Deletes a data file from the workspace.",
  class: "destructive-write",
  inputSchema: {
    name: z.string().describe("Data file name to delete"),
  },
  handler: async ({ name }) => {
    const ws = requireWs();
    const deleted = ws.deleteDataEntry(name);
    if (!deleted) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }] };
    }
    return { content: [{ type: "text" as const, text: `Data "${name}" deleted.` }] };
  },
});
