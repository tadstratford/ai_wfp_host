import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBODepartment } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_locations_list",
  description: "Fetches the QBO Location list (location tracking, exposed as Department in the QBO API) with Id and Name. Use this to resolve location Ids needed when posting journal entries with location allocations.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const departments = await client.departments();
    const active = departments.filter((d: QBODepartment) => d.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ locations: active, count: active.length }) }] };
  },
});
