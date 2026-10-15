import { defineTool } from "../../tool";
import { getRuleCatalog } from "../scope";

export default defineTool({
  name: "list_rules",
  description: "Lists all available rules with their descriptions. Use this before select_rule to find the right rule for the task.",
  class: "read",
  handler: async () => {
    const catalog = getRuleCatalog();
    return { content: [{ type: "text" as const, text: catalog }] };
  },
});
