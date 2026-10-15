import { Context } from "hono";
import { userManager } from "@backend/core/admin/userManager";
import { getCreditStatus } from "@shared/llm/credit";
import type { User } from "@backend/types";

/**
 * Beta credit card + redemption. Rendered into #credit-card on the /app/user
 * screen. The card is self-refreshing: GET /app/api/credit-status renders the
 * summary, and POST /app/api/redeem-code applies a code and re-renders it.
 */

function usd(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function creditCard(opts: {
  balance: number;
  used: number;
  remaining: number;
  message?: { type: "success" | "error"; text: string } | null;
}) {
  const { balance, used, remaining, message } = opts;
  const pct = balance > 0 ? Math.min(100, (used / balance) * 100) : 0;

  return (
    <div id="credit-card" class="card p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Beta Credit</h3>
        <span class="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
          beta
        </span>
      </div>

      <div>
        <div class="text-2xl font-bold text-gray-900 dark:text-white">
          {usd(remaining)}
          <span class="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500">remaining</span>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {usd(balance)} granted · {usd(used)} used
        </div>
      </div>

      <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          class="h-full bg-amber-500 rounded-full transition-all"
          style={`width:${pct}%`}
        />
      </div>

      {message && (
        <div
          class={`text-xs px-3 py-2 rounded-md ${
            message.type === "success"
              ? "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30"
              : "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30"
          }`}
        >
          {message.text}
        </div>
      )}

      <form
        hx-post="/app/api/redeem-code"
        hx-target="#credit-card"
        hx-swap="outerHTML"
        class="flex gap-2"
      >
        <input
          type="text"
          name="code"
          placeholder="BETA-XXXX-XXXX"
          autocomplete="off"
          class="flex-1 min-w-0 px-3 py-2 text-sm font-mono uppercase border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
        <button
          type="submit"
          class="shrink-0 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Apply
        </button>
      </form>
    </div>
  );
}

export const creditStatusHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const { balance, used } = await getCreditStatus(user.userId);
  const remaining = Math.max(0, balance - used);
  return c.html(creditCard({ balance, used, remaining }));
};

export const redeemCodeHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const body = await c.req.parseBody();
  const code = (body.code as string || "").trim().toUpperCase();

  let message: { type: "success" | "error"; text: string } | null = null;

  if (code) {
    const result = await userManager.redeemBetaCode(user.userId, code);
    if (result.ok) {
      message = { type: "success", text: `${usd(result.creditUsd ?? 0)} credit added.` };
    } else if (result.error === "invalid") {
      message = { type: "error", text: "Invalid code. Please check it and try again." };
    } else if (result.error === "already_used") {
      message = { type: "error", text: "That code has already been used." };
    } else {
      message = { type: "error", text: "Something went wrong. Please try again." };
    }
  } else {
    message = { type: "error", text: "Enter a code." };
  }

  const { balance, used } = await getCreditStatus(user.userId);
  const remaining = Math.max(0, balance - used);
  return c.html(creditCard({ balance, used, remaining, message }));
};
