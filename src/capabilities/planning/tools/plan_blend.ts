import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, writeEntry, FACTS_ENTRY, text } from "../scope";
import { blend, mergeRows } from "@workspace/planning/engine";
import type { FactRow } from "wfp-format";

export default defineTool({
  name: "plan_blend",
  description: "Builds a 'Latest estimate' version: actuals through cutover_per, forecast after it. The result is written back as a new version so it can be compared like any other.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    fy: z.number().int().describe("Fiscal year."),
    cutover_per: z.number().int().min(1).max(12).describe("Last period taken from actuals."),
    actuals: z.string().optional().describe("Actuals version name (default 'actuals')."),
    forecast: z.string().optional().describe("Forecast version name (default 'Forecast')."),
    out: z.string().optional().describe("Output version name (default 'Latest estimate')."),
  },
  handler: async ({ fy, cutover_per, actuals, forecast, out }) => {
    const ws = requireWs();
    const facts = readEntry<FactRow>(ws, FACTS_ENTRY);
    const blended = blend(facts, fy, cutover_per, {
      ...(actuals ? { actuals } : {}),
      ...(forecast ? { forecast } : {}),
      ...(out ? { out } : {}),
    });
    const merged = mergeRows(facts, blended);
    writeEntry(ws, FACTS_ENTRY, merged, ["fiscal year", "version", "account"]);
    return text({ fy, cutover_per, rows: blended.length, total_rows: merged.length });
  },
});
