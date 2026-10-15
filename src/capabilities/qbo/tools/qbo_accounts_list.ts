import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOAccount } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_accounts_list",
  description: "Fetches all active accounts from QuickBooks Online with balances and types.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const accounts = await client.accounts();
    const active = accounts.filter((a: QBOAccount) => a.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ accounts: active, count: active.length }) }] };
  },
});
