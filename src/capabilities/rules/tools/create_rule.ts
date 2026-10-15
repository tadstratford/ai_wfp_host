import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, normalizeName } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";

export default defineTool({
  name: "create_rule",
  description: "Creates a new user rule in the workspace. The content is markdown describing instructions and tools needed for a task. Errors if a rule with the same name already exists.",
  class: "control",
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Rule name (e.g., 'interco-rules'). Whitespace is converted to dashes and lowercased."),
    content: z.string().describe("Markdown body: '## Instructions' steps and '## Tools needed' list."),
    description: z.string().optional().describe("Clear, concise summary of what this rule does."),
    tags: z.array(z.string()).optional().describe("Optional tags for grouping, e.g. ['accounting', 'reconciliation']."),
  },
  handler: async ({ name, content, description, tags }) => {
    const normalized = normalizeName(name);
    if (!normalized || !content.trim()) {
      return { content: [{ type: "text" as const, text: "name and content are required." }], isError: true };
    }
    const ws = requireWs();
    if (ws.getRule(normalized)) {
      return { content: [{ type: "text" as const, text: `Rule "${normalized}" already exists. Use update_rule to change it.` }], isError: true };
    }
    ws.upsertRule({
      name: normalized,
      ...(description?.trim() ? { description: description.trim() } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      content: content.trim(),
    });
    notifyClients("global", "rule_update");
    return { content: [{ type: "text" as const, text: `Rule "${normalized}" created.` }] };
  },
});
