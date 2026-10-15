import { defineTool } from "../../tool";
import { requireScope } from "../scope";
import { clearQboTokens } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_disconnect",
  description: "Disconnects QuickBooks Online from this workspace by clearing the workspace's tokens (in-memory cache and persisted secret).",
  class: "control",
  handler: async () => {
    const scope = requireScope();
    clearQboTokens(scope);
    return { content: [{ type: "text" as const, text: JSON.stringify({ disconnected: true }) }] };
  },
});
