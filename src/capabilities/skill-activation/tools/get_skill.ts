import { z } from "zod";
import { defineTool } from "../../tool";
import { ensureEnabled, normalizeName, getDatabaseId } from "../scope";
import { loadAllSkills } from "@core/skills/loader";

export default defineTool({
  name: "get_skill",
  description: "Gets a skill's full details (name, description, scope, tags, source, content). Use list_skills first to find skill names.",
  class: "read",
  inputSchema: {
    name: z.string().describe("Skill name to fetch."),
  },
  handler: async ({ name }) => {
    await ensureEnabled();
    const normalized = normalizeName(name);
    const skill = loadAllSkills(undefined, getDatabaseId() ?? undefined).find((s) => s.name === normalized);
    if (!skill) {
      return { content: [{ type: "text" as const, text: `Skill "${normalized}" not found.` }], isError: true };
    }
    const body = skill.content.replace(/^---[\s\S]*?---\n*/, "").trim();
    return { content: [{ type: "text" as const, text: JSON.stringify({ name: skill.name, description: skill.description, scope: skill.scope, tags: skill.tags, source: skill.source, content: body }, null, 2) }] };
  },
});
