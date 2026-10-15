import { z } from "zod";
import { defineTool } from "../../tool";
import { ensureEnabled, getSkillContent } from "../scope";

export default defineTool({
  name: "select_skill",
  description: "Activate a skill for the current task. Call this to get detailed instructions for a specific capability. Use list_skills first to see what's available.",
  class: "read",
  inputSchema: {
    name: z.string().describe("Skill name to activate (e.g., 'workflow-build', 'qbo-analysis', 'data-handling', 'plan', 'build')"),
  },
  handler: async ({ name }) => {
    await ensureEnabled();
    const content = getSkillContent(name);
    return { content: [{ type: "text" as const, text: content }] };
  },
});
