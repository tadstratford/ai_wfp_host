import { defineTool } from "../../tool";
import { requireWs, readEntry, DIM_ENTRY, text } from "../scope";
import type { AccountDim } from "wfp-format";

export default defineTool({
  name: "plan_dim_get",
  description: "Reads the reporting-account dimension: one row per reporting account with its kind (income/expense/balance), optional group, order, and the QBO accounts (qboSources) that feed it.",
  class: "read",
  output: { metaType: "json_object", tabular: false },
  handler: async () => {
    const ws = requireWs();
    const dim = readEntry<AccountDim>(ws, DIM_ENTRY);
    return text({ count: dim.length, dim });
  },
});
