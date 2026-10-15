import { defineTool } from "../../tool";
import { requireScope, notConnected } from "../scope";
import { QBOClient, checkQBOConnected, type QBOClass } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_classes_list",
  description: "Fetches the QBO Class list (for class tracking) with Id and Name. Use this to resolve class Ids needed when posting journal entries with class allocations.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    if (!(await checkQBOConnected(scope))) return notConnected();
    const client = new QBOClient(scope);
    await client.connect();
    const classes = await client.classes();
    const active = classes.filter((c: QBOClass) => c.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ classes: active, count: active.length }) }] };
  },
});
