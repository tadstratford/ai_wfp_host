import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "update_todo",
  description: "Updates a todo's status or label.",
  class: "control",
  inputSchema: {
    todo_id: z.string().describe("Todo ID to update"),
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional().describe("New status"),
    label: z.string().optional().describe("New label"),
  },
  handler: async ({ todo_id, status, label }) => {
    const ws = requireWs();
    const todos = ws.getTodos();
    const idx = todos.findIndex((t) => t.id === todo_id);
    if (idx === -1) {
      return { content: [{ type: "text" as const, text: `Todo "${todo_id}" not found.` }], isError: true };
    }
    if (status) todos[idx] = { ...todos[idx], status, updated_at: new Date().toISOString() } as any;
    if (label) todos[idx] = { ...todos[idx], label, updated_at: new Date().toISOString() } as any;
    ws.setTodos(todos);
    return { content: [{ type: "text" as const, text: `Todo "${todo_id}" updated.` }] };
  },
});
