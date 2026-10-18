/**
 * Capability loader — assembles every capability's McpServer from its per-tool
 * files and registers it with the MCP aggregator.
 *
 * Each capability module self-registers its metadata in the capability registry
 * at import time (side-effect); this loader connects the capability's tools to
 * the in-memory transport so they become callable by chat and the workflow
 * executor. Tools are declared one-per-file under `capabilities/<name>/tools/`
 * and auto-discovered by the capability module via `import.meta.glob`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { aggregator } from "../mcp/aggregator";
import { qboCapability } from "./qbo/capability";
import { qbodemoCapability } from "./qbodemo/capability";
import { planningCapability } from "./planning/capability";
import { dataCapability } from "./data/capability";
import { metadataCapability } from "./metadata/capability";
import { todosCapability } from "./todos/capability";
import { plansCapability } from "./plans/capability";
import { rulesCapability } from "./rules/capability";
import { skillActivationCapability } from "./skill-activation/capability";
import { judgeCapability } from "./judge/capability";
import { emailsCapability } from "./emails/capability";
import { workflowsCapability } from "./workflows/capability";
import type { CapabilityModule } from "./types";

/** The compiled-in capability list. Adding a capability = one folder + one line
 *  here (folders are not fs-scanned because the standalone binary can't load
 *  new TS at runtime — see the curated-remote path for runtime additions).
 *
 *  `sessions` and `build` are intentionally NOT capabilities: they need
 *  sessionId/userId/appHook context a standalone run cannot supply (see
 *  `src/mcp/scope.ts`). */
const CAPABILITIES: CapabilityModule[] = [
  qboCapability,
  qbodemoCapability,
  planningCapability,
  dataCapability,
  metadataCapability,
  todosCapability,
  plansCapability,
  rulesCapability,
  skillActivationCapability,
  judgeCapability,
  emailsCapability,
  workflowsCapability,
];

export async function initCapabilities(): Promise<void> {
  for (const cap of CAPABILITIES) {
    const server = new McpServer({
      name: cap.serverName,
      version: cap.manifest.version,
    });
    for (const tool of cap.tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          ...(tool.inputSchema ? { inputSchema: tool.inputSchema as any } : {}),
        },
        tool.handler as any,
      );
    }
    await aggregator.registerSubApp(cap.serverName, (transport) => server.connect(transport));
    console.log(
      `[Capabilities] Registered "${cap.manifest.key}" (${cap.tools.length} tools)`,
    );
  }
}
