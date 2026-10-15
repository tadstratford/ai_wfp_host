import { register, type TemplateContext } from ".";
import type { WidgetDefinition } from "@shared/types/widgetTypes";

const accountTableDefinition: WidgetDefinition = {
  widget_id: "account-table",
  name: "Account Table",
  description: "List of accounts with click-to-drill balances.",
  description_md: `## What it is
A table of accounts (account, description, balance) where the balance is a
click-to-drill link.

## data JSON example
\`\`\`json
[ { "account": "1000", "description": "Operating cash", "balance": 123450 } ]
\`\`\``,
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: {
        account: { type: "string" },
        description: { type: "string" },
        balance: { type: "number" },
      },
    },
  },
  apiVersion: "1.0.0",
};

register(accountTableDefinition, (data: unknown, ctx: TemplateContext) => {
  const accounts = data as any[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return `<div id="msg-${ctx.messageId}" class="text-sm text-gray-500">No accounts.</div>`;
  }
  const rows = accounts.map((a) => `
    <tr class="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
      <td class="py-2 px-3 text-sm font-mono">${esc(a.account ?? "")}</td>
      <td class="py-2 px-3 text-sm">${esc(a.description ?? "")}</td>
      <td class="py-2 px-3 text-sm text-right font-mono">
        <a href="#"
           hx-post="/sessions/${ctx.sessionId}/interact"
           hx-vals='${escAttr(JSON.stringify({ messageId: ctx.messageId, action: "drill", acct: a.account }))}'
           hx-target="#msg-${ctx.messageId}"
           hx-swap="outerHTML"
           class="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
          ${fmtDollars(a.balance ?? 0)}
        </a>
      </td>
    </tr>`).join("");

  return `<div id="msg-${ctx.messageId}" class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800">
          <th class="py-2 px-3 text-left font-semibold">Account</th>
          <th class="py-2 px-3 text-left font-semibold">Description</th>
          <th class="py-2 px-3 text-right font-semibold">Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
