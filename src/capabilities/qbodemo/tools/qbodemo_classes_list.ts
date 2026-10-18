import { defineTool } from "../../tool";
import { demoQbo } from "../store";

export default defineTool({
  name: "qbodemo_classes_list",
  description: "Fetches the QBO Class list from the DEMO QuickBooks company. In the demo the classes are the funds/entities (e.g. Alpha Growth Fund LP). Use this to resolve class Ids when posting allocation journal entries.",
  class: "read",
  handler: async () => {
    const classes = demoQbo.classes().filter((c) => c.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ company: demoQbo.companyName(), classes, count: classes.length }) }] };
  },
});
