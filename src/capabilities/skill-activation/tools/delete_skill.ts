import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, normalizeName } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "delete_skill",
  description: "Deletes a workspace skill from the workspace. Errors if the skill does not exist.",
  class: "destructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Skill name to delete."),
  },
  handler: async ({ name }) => {
    const normalized = normalizeName(name);
    const ws = requireWs();
    if (!ws.getRule(normalized)) {
      return { content: [{ type: "text" as const, text: `Skill "${normalized}" not found.` }], isError: true };
    }
    ws.deleteRule(normalized);
    notifyClients("global", "skill_update");
    return { content: [{ type: "text" as const, text: `Skill "${normalized}" deleted.` }] };
  },
});
