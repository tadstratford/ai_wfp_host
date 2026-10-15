import { z } from "zod";
import { defineTool } from "../../tool";
import { getRuleContent } from "../scope";

export default defineTool({
  name: "select_rule",
  description: "Activate a rule for the current task. Call this to get detailed instructions for a specific rule. Use list_rules first to see what's available.",
  class: "read",
  inputSchema: {
    name: z.string().describe("Rule name to activate"),
  },
  handler: async ({ name }) => {
    const content = getRuleContent(name);
    return { content: [{ type: "text" as const, text: content }] };
  },
});
