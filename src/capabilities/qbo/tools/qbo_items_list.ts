import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOItem } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_items_list",
  description: "Fetches the QBO products & services (Item) list with Id, Name, Type, and price. Use this to look up a product or service by name when it is not found in the chart of accounts (e.g. 'Plants and Soil').",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const items = await client.items();
    const active = items.filter((i: QBOItem) => i.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ items: active, count: active.length }) }] };
  },
});
