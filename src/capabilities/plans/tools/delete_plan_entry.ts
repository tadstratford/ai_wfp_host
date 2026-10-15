import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "delete_plan_entry",
  description: "Deletes a plan entry from the workspace.",
  class: "destructive-write",
  inputSchema: {
    plan_id: z.string().describe("Plan entry ID to delete"),
  },
  handler: async ({ plan_id }) => {
    const ws = requireWs();
    const plans = ws.getPlan();
    const filtered = plans.filter((p) => p.id !== plan_id);
    if (filtered.length === plans.length) {
      return { content: [{ type: "text" as const, text: `Plan entry "${plan_id}" not found.` }] };
    }
    ws.setPlan(filtered);
    notifyClients("global", "plan_update");
    return { content: [{ type: "text" as const, text: `Plan entry "${plan_id}" deleted.` }] };
  },
});
