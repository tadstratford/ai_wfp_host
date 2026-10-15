import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs } from "../scope";

export default defineTool({
  name: "delete_todo",
  description: "Deletes a todo from the workspace.",
  class: "destructive-write",
  inputSchema: {
    todo_id: z.string().describe("Todo ID to delete"),
  },
  handler: async ({ todo_id }) => {
    const ws = requireWs();
    const todos = ws.getTodos();
    const filtered = todos.filter((t) => t.id !== todo_id);
    if (filtered.length === todos.length) {
      return { content: [{ type: "text" as const, text: `Todo "${todo_id}" not found.` }] };
    }
    ws.setTodos(filtered);
    return { content: [{ type: "text" as const, text: `Todo "${todo_id}" deleted.` }] };
  },
});
