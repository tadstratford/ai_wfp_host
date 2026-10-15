import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, readEntry, DIM_ENTRY, FACTS_ENTRY } from "../scope";
import { variance, lastPerWithData, monthDetail } from "@workspace/planning/engine";
import { buildPlanVarianceReportHtml } from "@capabilities/planning/report";
import type { AccountDim, FactRow } from "wfp-format";

export default defineTool({
  name: "report_plan_variance",
  description: "Computes budget-vs-actual variance and renders it as a self-contained, brand-styled HTML report grouped by Income/Expense/Balance with a Net Income summary. Each line expands to its month-by-month Actual vs Budget detail. Deterministic — no LLM. Returns HTML text for a following chat_download(data=\"{{result}}\") step.",
  class: "read",
  output: { metaType: "text", tabular: false },
  durable: true,
  report: true,
  inputSchema: {
    fy: z.number().int().describe("Fiscal year."),
    base: z.string().describe("Base version, usually 'actuals'."),
    compare: z.string().describe("Compare version, e.g. 'budget1' or 'Forecast'."),
    from_per: z.number().int().min(1).max(12).optional().describe("First period (default 1)."),
    through_per: z.number().int().min(1).max(12).optional().describe("Last period (default: last with data in base)."),
    title: z.string().optional().describe("Report title (default 'Budget vs Actual')."),
  },
  handler: async ({ fy, base, compare, from_per, through_per, title }) => {
    const ws = requireWs();
    const dim = readEntry<AccountDim>(ws, DIM_ENTRY);
    const facts = readEntry<FactRow>(ws, FACTS_ENTRY);
    const rows = variance(facts, dim, {
      fy,
      base,
      compare,
      ...(from_per ? { fromPer: from_per } : {}),
      ...(through_per ? { throughPer: through_per } : {}),
    });
    const net = rows[rows.length - 1] ?? {
      account: "Net Income",
      kind: "income" as const,
      base: 0,
      compare: 0,
      variance: 0,
      variancePct: null,
      favorable: true,
    };
    const lines = rows.slice(0, -1).map((r) => ({
      account: r.account,
      group: r.group,
      kind: r.kind,
      base: r.base,
      compare: r.compare,
      variance: r.variance,
      variancePct: r.variancePct,
      favorable: r.favorable,
      months: monthDetail(facts, fy, base, compare, r.account),
    }));
    const workspace = ws.getMetadata()?.workspace ?? "Workspace";
    const html = buildPlanVarianceReportHtml({
      workspace,
      title: title ?? "Budget vs Actual",
      meta: {
        fy,
        base,
        compare,
        from: from_per ?? 1,
        through: through_per ?? lastPerWithData(facts, fy, base),
      },
      lines,
      netIncome: {
        account: net.account,
        group: net.group,
        kind: net.kind,
        base: net.base,
        compare: net.compare,
        variance: net.variance,
        variancePct: net.variancePct,
        favorable: net.favorable,
        months: [],
      },
    });
    return { content: [{ type: "text" as const, text: html }] };
  },
});
