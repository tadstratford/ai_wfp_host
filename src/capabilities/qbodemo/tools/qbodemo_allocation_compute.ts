import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, writeDataEntry } from "../scope";
import { computeAllocation } from "@capabilities/qbo/allocation";

const DEFAULT_STORE_TO = "staging_allocation_lines";

export default defineTool({
  name: "qbodemo_allocation_compute",
  description: "Computes a balanced allocation journal deterministically against the DEMO QuickBooks company: reads an allocation table (rows = funds/entities, columns = months → %) and an amounts table, splits the period total across entities (residual to the largest share), and writes the balanced debit/credit lines to a workspace data entry (interim table) for review before posting with qbodemo_journal_create. No LLM arithmetic.",
  class: "constructive-write",
  mutating: true,
  durable: true,
  inputSchema: {
    allocation_source: z.string().describe("Data entry with the allocation table (entity rows × month-name columns = allocation %)."),
    amounts_source: z.string().describe("Data entry with the amounts to allocate (a period column + an amount column)."),
    period: z.string().describe("Period to allocate, e.g. '2026-05' or 'May'."),
    debit_account: z.string().describe("Account name to debit for each entity's share."),
    credit_account: z.string().describe("Account name to credit for the full total (no entity)."),
    entity_column: z.string().optional().describe("Column in the allocation table holding the entity name (default: first non-month column)."),
    period_column: z.string().optional().describe("Column in the amounts table holding the period (default 'Month')."),
    amount_column: z.string().optional().describe("Column in the amounts table holding the amount (default 'Amount')."),
    description: z.string().optional().describe("Optional line description."),
    store_to: z.string().optional().describe(`Data entry name to write the computed lines to (default '${DEFAULT_STORE_TO}').`),
  },
  handler: async ({ allocation_source, amounts_source, period, debit_account, credit_account, entity_column, period_column, amount_column, description, store_to }) => {
    const ws = requireWs();

    let result;
    try {
      result = computeAllocation(ws, {
        allocationSource: allocation_source,
        amountsSource: amounts_source,
        period,
        debitAccount: debit_account,
        creditAccount: credit_account,
        ...(entity_column ? { entityColumn: entity_column } : {}),
        ...(period_column ? { periodColumn: period_column } : {}),
        ...(amount_column ? { amountColumn: amount_column } : {}),
        ...(description ? { description } : {}),
      });
    } catch (e) {
      return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
    }

    const storeTo = store_to ?? DEFAULT_STORE_TO;
    writeDataEntry(ws, storeTo, result.lines, ["account", "posting_type", "amount", "class", "description"]);

    const totalDebit = result.lines
      .filter((l) => l.posting_type === "Debit")
      .reduce((s, l) => s + l.amount, 0);
    const totalCredit = result.lines
      .filter((l) => l.posting_type === "Credit")
      .reduce((s, l) => s + l.amount, 0);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          stored_to: storeTo,
          period,
          total: result.total,
          percentages: result.percentages,
          lines: result.lines,
          balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        }),
      }],
    };
  },
});
