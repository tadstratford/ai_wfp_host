import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toDiscoveryTable } from "../scope";
import { profileTable } from "@data/profile";

export default defineTool({
  name: "profile_data",
  description:
    "Profiles a loaded tabular data file deterministically (no LLM): per-column blank/null counts, distinct values, type violations, and exact-duplicate rows. Optionally verifies explicit footings (e.g. 'Total Expenses' == 'Fund I Expenses' + 'Fund II Expenses'), reported to the cent. Returns counts only — no raw values — so nothing needs masking.",
  class: "read",
  output: { metaType: "json_object", tabular: true },
  durable: true,
  inputSchema: {
    name: z.string().describe("Data file name."),
    footings: z
      .array(
        z.object({
          leftColumn: z.string().describe("Column that should equal the sum."),
          rightColumns: z.array(z.string()).min(1).describe("Columns that should sum to it."),
        }),
      )
      .optional()
      .describe("Optional explicit footings to verify. Omit for completeness/duplicates only."),
  },
  handler: async ({ name, footings }) => {
    const ws = requireWs();
    const entry = ws.getDataEntry(name);
    if (!entry) {
      return { content: [{ type: "text" as const, text: `Data "${name}" not found.` }], isError: true };
    }
    const table = toDiscoveryTable(name, entry);
    if (!table) {
      return { content: [{ type: "text" as const, text: `Data "${name}" is not tabular.` }], isError: true };
    }

    const profile = profileTable(table, {
      footings: footings?.map((f) => ({ leftColumn: f.leftColumn, rightColumns: f.rightColumns })),
    });

    return { content: [{ type: "text" as const, text: JSON.stringify(profile, null, 2) }] };
  },
});
