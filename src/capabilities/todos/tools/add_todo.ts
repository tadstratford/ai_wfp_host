import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "add_todo",
  description: "Adds a todo item to the workspace.",
  class: "control",
  inputSchema: {
    label: z.string().describe("Todo label / title"),
    instruction: z.string().optional().describe("Detailed instruction for completing the todo"),
    type: z.enum(["triage", "workflow", "manual"]).optional().default("manual").describe("Todo type"),
    category: z.enum(["build", "data", "knowledge", "review", "general"]).optional().default("general").describe("Category"),
    workflow_id: z.string().optional().describe("Target workflow ID for workflow-type todos"),
    tag: z.string().optional().describe("Tag (e.g. '@Mary')"),
  },
  handler: async ({ label, instruction, type, category, workflow_id, tag }) => {
    const ws = requireWs();
    const todos = ws.getTodos();
    const todo: any = {
      id: `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      status: "pending",
      type,
      category,
      sort_order: todos.length,
      source: "user",
      created_at: new Date().toISOString(),
    };
    if (instruction) todo.instruction = instruction;
    if (workflow_id) todo.workflow_id = workflow_id;
    if (tag) todo.tag = tag;
    ws.setTodos([...todos, todo]);
    return { content: [{ type: "text" as const, text: `Todo "${label}" added (${todo.id}).` }] };
  },
});
