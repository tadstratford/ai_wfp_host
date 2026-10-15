import { defineTool } from "../../tool";
import { requireWs, DIM_ENTRY, text } from "../scope";

export default defineTool({
  name: "plan_dim_clear",
  description: "Deletes the reporting-account dimension.",
  class: "destructive-write",
  handler: async () => {
    const ws = requireWs();
    ws.deleteDataEntry(DIM_ENTRY);
    return text({ cleared: true });
  },
});
