import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, normalizeName } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "delete_rule",
  description: "Deletes a user rule from the workspace. Errors if the rule does not exist.",
  class: "destructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Rule name to delete."),
  },
  handler: async ({ name }) => {
    const normalized = normalizeName(name);
    const ws = requireWs();
    if (!ws.getRule(normalized)) {
      return { content: [{ type: "text" as const, text: `Rule "${normalized}" not found.` }], isError: true };
    }
    ws.deleteRule(normalized);
    notifyClients("global", "rule_update");
    return { content: [{ type: "text" as const, text: `Rule "${normalized}" deleted.` }] };
  },
});
