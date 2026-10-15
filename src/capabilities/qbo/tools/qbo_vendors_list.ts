import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOVendor } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_vendors_list",
  description: "Fetches the QBO Vendor list with Id and DisplayName. Use this to resolve vendor Ids needed when posting journal entries that reference a vendor on an Accounts Payable line.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const vendors = await client.vendors();
    const active = vendors.filter((v: QBOVendor) => v.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ vendors: active, count: active.length }) }] };
  },
});
