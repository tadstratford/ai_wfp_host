import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, normalizeName } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { findUnknownTools } from "@rules/validate";
import type { ToolRef } from "wfp-format/rule";

const toolRefSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
});

export default defineTool({
  name: "update_rule",
  description: "Updates an existing user rule. Only the fields provided are changed. Errors if the rule does not exist, or if a referenced tool does not exist.",
  class: "control",
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Name of the rule to update."),
    content: z.string().optional().describe("Replacement markdown body."),
    tools: z.array(toolRefSchema).optional().describe("Replacement structured tool references."),
    description: z.string().optional().describe("Replacement description."),
    tags: z.array(z.string()).optional().describe("Replacement tags."),
  },
  handler: async ({ name, content, description, tags, tools }) => {
    const normalized = normalizeName(name);
    const ws = requireWs();
    const existing = ws.getRule(normalized);
    if (!existing) {
      return { content: [{ type: "text" as const, text: `Rule "${normalized}" not found.` }], isError: true };
    }
    if (tools) {
      const unknown = await findUnknownTools(tools as ToolRef[]);
      if (unknown.length > 0) {
        return { content: [{ type: "text" as const, text: `Unknown tool(s): ${unknown.map((t) => `\`${t}\``).join(", ")}.` }], isError: true };
      }
    }
    ws.upsertRule({
      name: normalized,
      ...(description?.trim() ? { description: description.trim() } : { description: existing.description }),
      ...(tags && tags.length > 0 ? { tags } : existing.tags ? { tags: existing.tags } : {}),
      content: content?.trim() ? content.trim() : existing.content,
      ...(tools ? { tools: tools as ToolRef[] } : existing.tools ? { tools: existing.tools } : {}),
    });
    notifyClients("global", "rule_update");
    return { content: [{ type: "text" as const, text: `Rule "${normalized}" updated.` }] };
  },
});
