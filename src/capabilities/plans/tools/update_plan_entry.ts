import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "update_plan_entry",
  description: "Updates a plan entry's status or label.",
  class: "control",
  inputSchema: {
    plan_id: z.string().describe("Plan entry ID to update"),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional().describe("New status"),
    label: z.string().optional().describe("New label"),
  },
  handler: async ({ plan_id, status, label }) => {
    const ws = requireWs();
    const plans = ws.getPlan();
    const idx = plans.findIndex((p) => p.id === plan_id);
    if (idx === -1) {
      return { content: [{ type: "text" as const, text: `Plan entry "${plan_id}" not found.` }], isError: true };
    }
    if (status) plans[idx] = { ...plans[idx], status, updated_at: new Date().toISOString() } as any;
    if (label) plans[idx] = { ...plans[idx], label, updated_at: new Date().toISOString() } as any;
    ws.setPlan(plans);
    notifyClients("global", "plan_update");
    return { content: [{ type: "text" as const, text: `Plan entry "${plan_id}" updated.` }] };
  },
});
