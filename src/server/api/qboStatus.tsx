import { Context } from "hono";
import type { User } from "@backend/types";
import { getQboTokensHydrated, clearQboTokens, resolveQboScope } from "@capabilities/qbo/client";

/**
 * QuickBooks connection card — rendered into #qbo-status-card on the
 * /app/user screen. The connection is scoped to the active workspace (client)
 * and persisted per-workspace in the encrypted secrets vault, so each client
 * keeps its own QBO and switching workspaces can't leak another client's
 * connection. The card reflects the live state and offers Connect / Disconnect.
 * GET /app/api/qbo-status renders it; POST /app/api/qbo-disconnect clears
 * the workspace's tokens (in-memory cache + persisted secret) and re-renders.
 */

function qboStatusCard(opts: {
  connected: boolean;
  realmId?: string;
  companyName?: string;
  message?: { type: "success" | "error"; text: string } | null;
}) {
  const { connected, realmId, companyName, message } = opts;

  return (
    <div id="qbo-status-card" class="card p-5 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
          QuickBooks Online
        </h3>
        <span
          class={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full ${
            connected
              ? "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30"
              : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800"
          }`}
        >
          {connected ? "connected" : "not connected"}
        </span>
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

      {connected ? (
        <div class="space-y-3">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Your QuickBooks company is connected for this workspace.
          </p>
          <p class="text-xs font-medium text-gray-700 dark:text-gray-300">
            {companyName || "QuickBooks company"}
          </p>
          {realmId && (
            <p class="text-xs font-mono text-gray-400 dark:text-gray-500">
              Company ID: {realmId}
            </p>
          )}
          <form
            hx-post="/app/api/qbo-disconnect"
            hx-target="#qbo-status-card"
            hx-swap="outerHTML"
          >
            <button
              type="submit"
              class="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </form>
        </div>
      ) : (
        <div class="space-y-3">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Connect your QuickBooks account to let the assistant pull reports
            and post journals. Each workspace (client) keeps its own connection.
          </p>
          <a
            href="/auth/qbo"
            class="inline-block px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Connect to QuickBooks
          </a>
        </div>
      )}
    </div>
  );
}

export const qboStatusHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const scope = resolveQboScope(user.currentDatabaseId);
  const tokens = await getQboTokensHydrated(scope);
  const connected = !!tokens?.refresh_token;
  return c.html(
    qboStatusCard({
      connected,
      realmId: tokens?.realm_id,
      companyName: tokens?.company_name,
    }),
  );
};

export const qboDisconnectHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const scope = resolveQboScope(user.currentDatabaseId);
  clearQboTokens(scope);
  return c.html(
    qboStatusCard({
      connected: false,
      message: { type: "success", text: "QuickBooks disconnected." },
    }),
  );
};
