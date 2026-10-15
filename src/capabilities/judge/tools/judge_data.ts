import { z } from "zod";
import { defineTool } from "../../tool";
import { getDatabaseId, requireKey, toRows, synthSiblings } from "../scope";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { judgeRows } from "@shared/typesafe/judge";
import type { JudgeKind } from "@shared/typesafe/judge";

export default defineTool({
  name: "judge_data",
  description: "Advanced per-row classification with the typed Classifier (Jev): asks a question about every row and returns aggregated answers. kind='noul' returns a yes/no probability per row; kind='choice' picks an option per row; kind='score' rates each row against levels. Fan-out runs concurrently and is cached. Use only when you need a verdict per row — for a whole-dataset yes/no check, use check_data instead.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  durable: true,
  inputSchema: {
    name: z.string().describe("Data file name (a normalized table, e.g. synth_<name>_transactions)."),
    kind: z.enum(["noul", "choice", "score"]).describe("Question type: yes/no, pick-an-option, or rate-against-levels."),
    instructions: z.string().describe("The question to ask about each row, referencing its columns."),
    options: z.array(z.string()).optional().describe("For 'choice': the options; for 'score': the ordered levels."),
    columns: z.array(z.string()).optional().describe("Columns to include in each row's state (default: all)."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows to judge (default 200)."),
  },
  handler: async ({ name, kind, instructions, options, columns, limit }) => {
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
            text: `Data "${name}" is a raw sheet (json_cells), not a table. Judge one of its normalized tables: ${siblings.map((s) => `"${s}"`).join(", ")}.`,
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Data "${name}" is not a tabular table (csv/json_array). Resolve it first.` }],
        isError: true,
      };
    }

    let apiKey: string;
    try {
      apiKey = await requireKey();
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
    }

    const result = await judgeRows(rows, { kind: kind as JudgeKind, instructions, options }, {
      apiKey,
      columns,
      limit: limit ?? 200,
      databaseId: db ?? undefined,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
});
