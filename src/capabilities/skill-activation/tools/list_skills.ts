import { defineTool } from "../../tool";
import { ensureEnabled, getSkillCatalog } from "../scope";

export default defineTool({
  name: "list_skills",
  description: "Lists all available skills with their descriptions. Use this before select_skill to find the right skill for the task.",
  class: "read",
  handler: async () => {
    await ensureEnabled();
    const catalog = getSkillCatalog();
    return { content: [{ type: "text" as const, text: catalog }] };
  },
});
