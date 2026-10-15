import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOCustomer } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_customers_list",
  description: "Fetches the QBO Customer list with Id and DisplayName. Use this to resolve customer Ids needed when posting journal entries that reference a customer.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const customers = await client.customers();
    const active = customers.filter((c: QBOCustomer) => c.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ customers: active, count: active.length }) }] };
  },
});
