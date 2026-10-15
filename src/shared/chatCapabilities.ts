// chatCapabilities — the catalog of one-click capability prompts shown in the
// chat right rail. Each capability is a plain prompt; clicking appends it to the
// composer (never overwrites), and the Jev front-door classifier routes the
// combined message to the matching skill/tools. Adding a capability is a new
// entry here — no routing or NLP changes.

export interface ChatCapability {
  key: string;
  label: string;
  prompt: string;
}

export const CHAT_CAPABILITIES: ChatCapability[] = [
  {
    key: "budget-variance",
    label: "Budget vs actuals",
    prompt: "Build a budget vs actuals variance report for this fiscal year.",
  },
  {
    key: "pnl",
    label: "Profit & Loss",
    prompt: "Give me the QBO Profit & Loss for this year to date.",
  },
  {
    key: "balance-sheet",
    label: "Balance sheet",
    prompt: "Show me the QBO balance sheet as of the latest month end.",
  },
  {
    key: "cash-forecast",
    label: "Cash forecast",
    prompt: "Build a 13-week cash forecast.",
  },
];
