import { z } from "zod";
import { defineTool } from "../../tool";
import { getDatabaseId, requireKey, toRows, synthSiblings } from "../scope";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { checkDataset } from "@shared/typesafe/judge";

export default defineTool({
  name: "check_data",
  description: "Runs several broad yes/no checks over a whole loaded table in a single Classifier (Jev) call. Each check is a yes/no question about the dataset as a whole (e.g. 'are any rows missing a GL Account?'). This is the default way to check data — use judge_data only for advanced per-row classification.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  durable: true,
  inputSchema: {
    name: z.string().describe("Data file name (a normalized table, e.g. synth_<name>_transactions)."),
    checks: z.array(z.object({
      id: z.string().describe("Short stable id for this check (snake_case)."),
      question: z.string().describe("A yes/no question about the dataset as a whole."),
    })).describe("The broad checks to run."),
  },
  handler: async ({ name, checks }) => {
    const db = getDatabaseId();
    if (!db) {
      return { content: [{ type: "text" as const, text: "No active workspace." }], isError: true };
    }
    const ws = getSessionByDatabaseId(db);
    if (!ws) {
      return { content: [{ type: "text" as const, text: "No active workspace." }], isError: true };
    }
    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }

    const rows = toRows(entry);
    if (rows === null) {
      const siblings = synthSiblings(ws, name);
      if (siblings.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Data "${name}" is a raw sheet (json_cells), not a table. Check one of its normalized tables: ${siblings.map((s) => `"${s}"`).join(", ")}.`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Data "${name}" is not a tabular table (csv/json_array).` }],
        isError: true,
      };
    }

    let apiKey: string;
    try {
      apiKey = await requireKey();
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
    }

    const result = await checkDataset(rows, checks, {
      apiKey,
      limit: 200,
      databaseId: db ?? undefined,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
});
