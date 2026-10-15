import type { AnthropicTool } from "@backend/core/models/types";

export const personaClaudeTools: AnthropicTool[] = [
    {
        name: "set_persona_content",
        description:
            "Rewrite the complete client persona document. Call this whenever you have gathered enough information to update the persona markdown. Always send the full document — this replaces the existing content entirely.",
        input_schema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description:
                        "The complete client persona as a markdown document. Include all sections: Company Overview, Key Contacts, Services & Engagements, Calendar & Deadlines, Special Notes & Cautions, and Communication Preferences. Only include sections where you have real information.",
                },
            },
            required: ["content"],
        },
    },
];
