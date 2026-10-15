import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, toRows, maskRow, buildMasker } from "../scope";
import { buildDrilldownReportHtml } from "@capabilities/data/drilldown";

export default defineTool({
  name: "report_table",
  description: "Builds a self-contained HTML drill-down report from a summary table and its detail rows. Each summary row expands to reveal the detail rows whose group_by columns match. Deterministic — no LLM. Returns the HTML document as text for a following chat_download step.",
  class: "read",
  output: { metaType: "text", tabular: false },
  durable: true,
  report: true,
  inputSchema: {
    summary: z.string().describe("Data name holding the summarized rows (e.g. a staging_* table)."),
    details: z.string().describe("Data name holding the detail/transaction rows."),
    group_by: z.array(z.string()).describe("Columns (present in both tables) that link each detail row to its summary group."),
    detail_columns: z.array(z.string()).optional().describe("Detail columns to show in the expanded rows. Defaults to the details table's columns."),
    title: z.string().optional().describe("Report title (default 'Report')."),
  },
  handler: async ({ summary, details, group_by, detail_columns, title }) => {
    const ws = requireWs();
    const summaryEntry = ws.getDataEntry(summary);
    if (!summaryEntry) {
      return { content: [{ type: "text" as const, text: `Data "${summary}" not found.` }], isError: true };
    }
    const detailEntry = ws.getDataEntry(details);
    if (!detailEntry) {
      return { content: [{ type: "text" as const, text: `Data "${details}" not found.` }], isError: true };
    }

    const summaryRows = toRows(summaryEntry);
    if (summaryRows === null) {
      return { content: [{ type: "text" as const, text: `Summary "${summary}" is not tabular.` }], isError: true };
    }
    const detailRows = toRows(detailEntry);
    if (detailRows === null) {
      return { content: [{ type: "text" as const, text: `Details "${details}" is not tabular.` }], isError: true };
    }

    const masker = buildMasker();
    const sRows = summaryRows.map((r) => maskRow(r, masker));
    const dRows = detailRows.map((r) => maskRow(r, masker));

    const workspace = ws.getMetadata()?.workspace ?? "Workspace";
    const detailCols =
      detail_columns && detail_columns.length > 0
        ? detail_columns
        : (detailEntry.columns ?? (dRows.length > 0 ? Object.keys(dRows[0]) : []));

    const html = buildDrilldownReportHtml({
      workspace,
      title: title ?? "Report",
      summaryRows: sRows,
      detailRows: dRows,
      groupBy: group_by,
      detailColumns: detailCols,
      sources: [summary, details],
    });

    return { content: [{ type: "text" as const, text: html }] };
  },
});
