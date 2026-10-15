import { loadAppSkills } from "../../core/skills/loader";
import type { SkillWithSource } from "../../core/skills/loader";
import type { ProviderToolSchema } from "@backend/core/llm/providers";

/** Forced tool the router must call to return its skill selection. */
export const ROUTE_REQUEST_TOOL: ProviderToolSchema = {
  name: "route_request",
  description: "Submit which skills to activate for the user's request.",
  input_schema: {
    type: "object",
    properties: {
      selectedSkills: {
        type: "array",
        items: { type: "string" },
        description: "Names of the skills to activate (empty array if none match).",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation for the selection.",
      },
    },
    required: ["selectedSkills"],
  },
};

/** Skills the routing prompt exposes — core skills plus the database's enabled groups. */
function systemSkills(databaseId?: string): SkillWithSource[] {
  return loadAppSkills(databaseId).filter(
    (s) => !s.scope || s.scope === "chat" || s.scope === "chat+workflow",
  );
}

export function getSystemSkillNames(databaseId?: string): string[] {
  return systemSkills(databaseId).map((s) => s.name);
}

export function buildSkillsPrompt(databaseId?: string): string {
  const systemSection = formatSkillGroup(systemSkills(databaseId), "System Skills");

  return `You are a task router for WorkflowPeople. Your job is to pick which skills to activate based on the user's request.

${systemSection}

Rules:
- Pick 1-3 skills that best match the user's request.
- If the user mentions a skill by name (e.g., "/workflow-build"), select that skill.
- If no skills match, return an empty list.

Call the \`route_request\` tool to submit your selection: put the chosen skill names in \`selectedSkills\` (empty array if none match) and a brief \`reasoning\`.`;
}

function formatSkillGroup(
  skills: SkillWithSource[],
  title: string,
): string {
  const items = skills
    .map((s) => `- **${s.name}**: ${s.description || "(no description)"}`)
    .join("\n");
  return `## ${title}\n${items}`;
}
