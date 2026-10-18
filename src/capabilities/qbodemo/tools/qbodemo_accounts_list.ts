import { defineTool } from "../../tool";
import { demoQbo } from "../store";

export default defineTool({
  name: "qbodemo_accounts_list",
  description: "Fetches the chart of accounts from the DEMO QuickBooks company (Acme Fund Services). Returns every active account with Id, name, type, subtype, and classification. Use this to resolve account Ids for mapping and journal posting in demos.",
  class: "read",
  output: { metaType: "json_array", tabular: true },
  handler: async () => {
    const accounts = demoQbo.accounts().filter((a) => a.Active !== false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ company: demoQbo.companyName(), accounts, count: accounts.length }) }] };
  },
});
