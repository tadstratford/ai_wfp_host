import { z } from "zod";
import { defineTool } from "../../tool";
import { normalizeName, getDatabaseId } from "../scope";
import { loadRules } from "@rules/loader";

export default defineTool({
  name: "get_rule",
  description: "Gets a rule's full details (name, description, tags, content). Use list_rules first to find rule names.",
  class: "read",
  inputSchema: {
    name: z.string().describe("Rule name to fetch."),
  },
  handler: async ({ name }) => {
    const normalized = normalizeName(name);
    const db = getDatabaseId();
    if (!db) return { content: [{ type: "text" as const, text: "No workspace open." }] };
    const rule = loadRules(db).find((r) => r.name === normalized);
    if (!rule) {
      return { content: [{ type: "text" as const, text: `Rule "${normalized}" not found.` }], isError: true };
    }
    const body = rule.content.replace(/^---[\s\S]*?---\n*/, "").trim();
    return { content: [{ type: "text" as const, text: JSON.stringify({ name: rule.name, description: rule.description, tags: rule.tags, content: body }, null, 2) }] };
  },
});
