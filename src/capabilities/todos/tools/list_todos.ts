import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "list_todos",
  description: "Lists all todos in the workspace. Optionally filter by status.",
  class: "read",
  inputSchema: {
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional().describe("Filter by status"),
  },
  handler: async ({ status }) => {
    const ws = requireWs();
    let todos = ws.getTodos();
    if (status) todos = todos.filter((t) => t.status === status);
    const text = todos.length === 0
      ? "No todos found."
      : JSON.stringify(todos, null, 2);
    return { content: [{ type: "text" as const, text }] };
  },
});
