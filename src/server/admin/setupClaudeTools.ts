import type { AnthropicTool } from "@backend/core/models/types";

export const setupClaudeTools: AnthropicTool[] = [
    {
        name: "set_setup_document",
        description:
            "Rewrite the complete app setup document. Call this after gathering any new information or after creating any entity. Always send the full document — this replaces the existing content entirely. Use Status columns to mark items as Planned vs Created.",
        input_schema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description:
                        "The complete setup document as markdown. Sections: Database, Departments, Users, Workflows. Mark created items with ✅.",
                },
            },
            required: ["content"],
        },
    },
    {
        name: "create_app_database",
        description:
            "Create and register a new app database for this client. This initializes the SQLite file and all tables. Returns the database_id needed for creating workflows. Only call this when the admin has confirmed the database name.",
        input_schema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description:
                        "Short database name, lowercase, no spaces (e.g. 'oakridge', 'hartwell'). Used as a human-readable label; the actual file uses a generated ID.",
                },
            },
            required: ["name"],
        },
    },
    {
        name: "add_department",
        description:
            "Create a new department in the admin system. Departments are workspace-wide and appear as swim lanes in all workflows. Only call this when the admin has confirmed the department. Skip departments that already exist in {{EXISTING_DEPARTMENTS}}.",
        input_schema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Department name (e.g. 'Client Accounting', 'AI: Bookkeeping')",
                },
                rate_per_hour: {
                    type: "number",
                    description: "Blended hourly rate in dollars. AI swim lanes are typically $15/hr.",
                },
                is_ai_swim_lane: {
                    type: "boolean",
                    description:
                        "True for AI swim lanes (enables ROI comparison vs human rate in reports). Name should start with 'AI:' by convention.",
                },
            },
            required: ["name", "rate_per_hour", "is_ai_swim_lane"],
        },
    },
    {
        name: "add_user",
        description:
            "Create a new user record. The user activates their account by signing up at the app URL with the matching email (Kinde email match). Only call this when the admin has confirmed the user details.",
        input_schema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Full name",
                },
                email: {
                    type: "string",
                    description: "Email address — must match what they will use to sign in",
                },
                role: {
                    type: "string",
                    description: "Job title or role (e.g. 'Senior Accountant', 'Client Contact', 'Partner')",
                },
                rate_per_hour: {
                    type: "number",
                    description: "Hourly rate for reporting. Use 0 for client contacts.",
                },
                is_admin: {
                    type: "boolean",
                    description: "True for admin-level access to the admin panel",
                },
            },
            required: ["name", "email", "role", "rate_per_hour", "is_admin"],
        },
    },
    {
        name: "create_workflow",
        description:
            "Create a workflow with a strawman set of steps in a client database. Start and End nodes are added automatically — only provide the content steps in between. Only call this after create_app_database has been called and returned a database_id.",
        input_schema: {
            type: "object",
            properties: {
                database_id: {
                    type: "string",
                    description: "The database_id returned by create_app_database",
                },
                name: {
                    type: "string",
                    description: "Workflow name (e.g. 'Monthly Bookkeeping Close')",
                },
                description: {
                    type: "string",
                    description: "Brief description of what this workflow does",
                },
                nodes: {
                    type: "array",
                    description:
                        "Ordered list of workflow steps. Do not include Start or End — those are added automatically.",
                    items: {
                        type: "object",
                        properties: {
                            label: {
                                type: "string",
                                description: "Step label shown in the workflow canvas",
                            },
                            department: {
                                type: "string",
                                description:
                                    "Department responsible for this step (e.g. 'AI: Bookkeeping', 'Client Accounting', 'Management Review')",
                            },
                            step_type: {
                                type: "string",
                                enum: ["message", "ai", "human", "integration"],
                                description:
                                    "'message' — a tracked work step that posts a status update to the session chat. 'ai' — an AI reasoning step (categorization, analysis, summarization). 'human' — a human review, sign-off, or data-entry step. 'integration' — a step that calls an external system; pair with tool_name.",
                            },
                            tool_name: {
                                type: "string",
                                description: "Name of a built-in or MCP tool to use for this step. Only used when step_type is 'integration'.",
                            },
                            chat_msg_body: {
                                type: "string",
                                description: "Markdown message posted to the session chat when this step completes. Use for step_type 'message'. Include a ## heading, a one-sentence description, and a bullet list of 3–5 tasks.",
                            },
                            notes: {
                                type: "string",
                                description: "Optional notes or instructions for this step",
                            },
                        },
                        required: ["label", "type", "department"],
                    },
                },
            },
            required: ["database_id", "name", "nodes"],
        },
    },
];
