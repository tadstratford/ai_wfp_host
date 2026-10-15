import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, writeEntry, parseJsonArray, FACTS_ENTRY, text, err } from "../scope";
import { mergeRows } from "@workspace/planning/engine";
import type { FactRow } from "wfp-format";

export default defineTool({
  name: "plan_facts_upsert",
  description: "Writes planning fact rows. A row is { \"fiscal year\", version, account, per_1..per_12 } where per_n is a number or null (null = no data). In 'merge' mode non-null periods overwrite existing rows (default); 'replace' clears first.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    rows: z.string().describe("JSON array of fact rows."),
    mode: z.enum(["merge", "replace"]).optional().describe("Default 'merge'."),
  },
  handler: async ({ rows, mode }) => {
    const ws = requireWs();
    let arr: unknown[];
    try {
      arr = parseJsonArray(rows, "rows");
    } catch (e) {
      return err((e as Error).message);
    }
    const incoming = arr as FactRow[];
    const existing = mode === "replace" ? [] : readEntry<FactRow>(ws, FACTS_ENTRY);
    const merged = mergeRows(existing, incoming);
    writeEntry(ws, FACTS_ENTRY, merged, ["fiscal year", "version", "account"]);
    return text({ saved: incoming.length, total_rows: merged.length });
  },
});
