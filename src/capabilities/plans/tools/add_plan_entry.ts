import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "add_plan_entry",
  description: "Adds a single entry to the project plan.",
  class: "control",
  inputSchema: {
    label: z.string().describe("Plan entry label"),
    instruction: z.string().optional().describe("Detailed instruction for this step"),
    source: z.enum(["planner", "user", "audit", "system"]).optional().default("planner").describe("Entry source"),
  },
  handler: async ({ label, instruction, source }) => {
    const ws = requireWs();
    const plans = ws.getPlan();
    const entry: any = {
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      status: "pending",
      source,
      sort_order: plans.length,
      created_at: new Date().toISOString(),
    };
    if (instruction) entry.instruction = instruction;
    ws.setPlan([...plans, entry]);
    notifyClients("global", "plan_update");
    return { content: [{ type: "text" as const, text: `Plan entry "${label}" added.` }] };
  },
});
