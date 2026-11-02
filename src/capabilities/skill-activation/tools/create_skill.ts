import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, normalizeName, findSkill } from "../scope";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { findUnknownTools } from "@rules/validate";
import type { ToolRef } from "wfp-format/rule";

const toolRefSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
});

export default defineTool({
  name: "create_skill",
  description: "Creates a new workspace skill in the workspace. `content` is markdown instructions/rules; `tools` is a structured list of the tools the skill's method uses. Errors if a skill with the same name already exists, or if a referenced tool does not exist.",
  class: "control",
  mutating: true,
  durable: true,
  inputSchema: {
    name: z.string().describe("Skill name (e.g., 'interco-rules'). Whitespace is converted to dashes and lowercased."),
    content: z.string().describe("Markdown body: '## Instructions' steps and '## Rules' constraints."),
    tools: z.array(toolRefSchema).optional().describe("Structured tool references the skill's method uses (each name must be a real tool)."),
    description: z.string().optional().describe("Clear, concise summary of what this skill does."),
    tags: z.array(z.string()).optional().describe("Optional tags for grouping, e.g. ['accounting', 'reconciliation']."),
  },
  handler: async ({ name, content, description, tags, tools }) => {
    const normalized = normalizeName(name);
    if (!normalized || !content.trim()) {
      return { content: [{ type: "text" as const, text: "name and content are required." }], isError: true };
    }
    const ws = requireWs();
    if (findSkill(normalized)) {
      return { content: [{ type: "text" as const, text: `Skill "${normalized}" already exists. Use update_skill to change it.` }], isError: true };
    }
    const refs: ToolRef[] | undefined = tools && tools.length > 0 ? tools : undefined;
    if (refs) {
      const unknown = await findUnknownTools(refs);
      if (unknown.length > 0) {
        return { content: [{ type: "text" as const, text: `Unknown tool(s): ${unknown.map((t) => `\`${t}\``).join(", ")}. Fix the tool names and retry.` }], isError: true };
      }
    }
    ws.upsertRule({
      name: normalized,
      ...(description?.trim() ? { description: description.trim() } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(refs ? { tools: refs } : {}),
      content: content.trim(),
    });
    notifyClients("global", "skill_update");
    return { content: [{ type: "text" as const, text: `Skill "${normalized}" created.` }] };
  },
});
