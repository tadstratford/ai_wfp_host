import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "list_plans",
  description: "Lists all project plan entries in the workspace.",
  class: "read",
  handler: async () => {
    const ws = requireWs();
    const plans = ws.getPlan();
    const text = plans.length === 0
      ? "No plans found."
      : JSON.stringify(plans, null, 2);
    return { content: [{ type: "text" as const, text }] };
  },
});
