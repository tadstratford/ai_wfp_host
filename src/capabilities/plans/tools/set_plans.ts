import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "set_plans",
  description: "Replaces the entire project plan with a new list. IMPORTANT: pass plans as a JSON string, NOT as an array. Example: '[{\"label\":\"Step 1\",\"instruction\":\"Do X\"}]'",
  class: "control",
  inputSchema: {
    plans: z.string().describe("JSON STRING of an array of plan entries. Must be a string, not a raw array. Each entry: { label, instruction?, status?, source? }"),
  },
  handler: async ({ plans }) => {
    let entries: any[];
    try { entries = JSON.parse(plans); } catch {
      return { content: [{ type: "text" as const, text: `Invalid JSON for plans. Pass a JSON string like '[{"label":"Step 1"}]', not a raw array.` }], isError: true };
    }
    if (!Array.isArray(entries)) {
      return { content: [{ type: "text" as const, text: "plans must be a JSON array." }], isError: true };
    }
    const ws = requireWs();
    const now = new Date().toISOString();
    const plan = entries.map((e, i) => ({
      id: e.id || `plan-${Date.now().toString(36)}-${i}`,
      label: e.label || `Step ${i + 1}`,
      instruction: e.instruction || "",
      status: e.status || "pending",
      source: e.source || "planner",
      sort_order: e.sort_order ?? i,
      created_at: e.created_at || now,
    }));
    ws.setPlan(plan);
    notifyClients("global", "plan_update");
    return { content: [{ type: "text" as const, text: `Plan set with ${plan.length} entries.` }] };
  },
});
