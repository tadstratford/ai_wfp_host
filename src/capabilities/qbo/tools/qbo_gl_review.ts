import { z } from "zod";
import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_gl_review",
  description: "Analyzes the QBO chart of accounts and trial balance for GL misclassifications, inconsistency flags, and unusual account usage.",
  class: "read",
  inputSchema: {
    date: z.string().optional().describe("As-of date for trial balance (YYYY-MM-DD). Defaults to latest."),
    llm_analysis: z.boolean().optional().describe("Run additional LLM-based analysis for deeper patterns."),
  },
  handler: async ({ date, llm_analysis }) => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();

    const misclassRules = [
      { pattern: /(rent|lease)/i, expected: "Rent Expense", warning: "Rent/lease entries should be in Rent Expense." },
      { pattern: /(salary|wages|payroll)/i, expected: "Payroll Expense", warning: "Payroll entries should be in Payroll Expense." },
      { pattern: /(interest|bank fee|service charge)/i, expected: "Bank Charges", warning: "Bank fees/interest should be in Bank Charges." },
      { pattern: /(advertising|marketing|promotion)/i, expected: "Advertising", warning: "Marketing/advertising should be in Advertising." },
      { pattern: /(repair|maintenance)/i, expected: "Repairs & Maintenance", warning: "Repair/maintenance should be in R&M." },
    ];

    const [accounts, tbResult] = await Promise.all([
      client.accounts(),
      client.trialBalance(date || undefined),
    ]);

    const tbRows: Array<{ account: string; balance: number }> = tbResult?.Rows?.Row
      ?.filter((r: any) => r.type === "Data" || r.ColData)
      ?.map((r: any) => {
        const cols = r.ColData || [];
        return { account: cols[0]?.value ?? "", balance: parseFloat(cols[1]?.value ?? cols[2]?.value ?? "0") };
      }) ?? [];

    const flags: any[] = [];
    const tbMap = new Map(tbRows.map((r) => [r.account, r.balance]));

    for (const acct of accounts) {
      const balance = tbMap.get(acct.Name) ?? acct.CurrentBalance ?? 0;

      if (acct.AccountType === "Other Expense" && Math.abs(balance) > 1000) {
        flags.push({ account: acct.Name, type: acct.AccountType, balance, issue: 'Large balance in "Other Expense" — may be misclassified', severity: "high" });
      }
      if (acct.AccountType === "Other Income" && Math.abs(balance) > 1000) {
        flags.push({ account: acct.Name, type: acct.AccountType, balance, issue: 'Large balance in "Other Income" — may be misclassified', severity: "medium" });
      }
      for (const rule of misclassRules) {
        if (rule.pattern.test(acct.Name)) {
          if (acct.AccountType !== rule.expected && !acct.AccountType.includes(rule.expected)) {
            flags.push({ account: acct.Name, type: `${acct.AccountType} > ${acct.AccountSubType}`, balance, issue: rule.warning, severity: "medium" });
          }
        }
      }
    }

    const high = flags.filter((f) => f.severity === "high").length;
    const med = flags.filter((f) => f.severity === "medium").length;
    let summary = `Found ${flags.length} flags (${high} high, ${med} medium).`;
    if (high > 0) summary += ` High-priority items need immediate review.`;
    if (flags.length === 0) summary = "No issues found. Chart of accounts looks clean.";

    return { content: [{ type: "text" as const, text: JSON.stringify({ flags, summary, llm_analysis_requested: !!llm_analysis }) }] };
  },
});
