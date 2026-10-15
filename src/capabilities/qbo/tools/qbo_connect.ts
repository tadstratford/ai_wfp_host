import { defineTool } from "../../tool";
import { requireScope } from "../scope";
import { checkQBOConnected } from "@capabilities/qbo/client";

export default defineTool({
  name: "qbo_connect",
  description: "Connect or check connection to QuickBooks Online. Returns connected status and OAuth URL if not connected. Display the OAuth link to the user via show_message with a clickable markdown link.",
  class: "read",
  handler: async () => {
    const scope = requireScope();
    console.log(`[qbo_connect] Checking QBO connection for scope=${scope}`);
    const connected = await checkQBOConnected(scope);
    console.log(`[qbo_connect] Connected: ${connected}`);
    if (connected) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ connected: true }) }] };
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          connected: false,
          oauthUrl: "/auth/qbo",
          link: "[Authorize QuickBooks Online](/auth/qbo)",
          instructions: "The user must authorize QBO by opening the OAuth link. Use show_message to display a clickable link to the user.",
        }),
      }],
    };
  },
});
