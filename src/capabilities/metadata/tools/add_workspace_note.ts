import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "add_workspace_note",
  description: "Adds a note to the workspace.",
  class: "control",
  inputSchema: {
    text: z.string().describe("Note text"),
  },
  handler: async ({ text }) => {
    const ws = requireWs();
    const meta = ws.getMetadata();
    const notes = [...(meta.notes ?? []), { text, created_at: new Date().toISOString() }];
    ws.updateMetadata({ notes } as any);
    return { content: [{ type: "text" as const, text: "Note added." }] };
  },
});
