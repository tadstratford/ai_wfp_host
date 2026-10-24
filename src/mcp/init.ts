import { aggregator } from "./aggregator";
import { registerMcpTool } from "../core/tools/registry";
import { initCapabilities } from "../capabilities";
import { initSessionsServer } from "./servers/app-wfp-sessions";
import { initBuildServer } from "./servers/app-wfp-build";
import { initDiaryServer } from "./servers/app-diary";

let initialized = false;

export async function initMcp() {
  if (initialized) return;

  // Curated capabilities — registered via the capability loader (single path).
  await initCapabilities();

  // Context-bound servers that are NOT capabilities: `sessions` needs
  // sessionId/appHook, `build` needs buildContext. Kept here deliberately.
  await aggregator.registerSubApp("sessions", initSessionsServer);
  await aggregator.registerSubApp("build", initBuildServer);
  await aggregator.registerSubApp("diary", initDiaryServer);

  // Register all MCP tools into the workflow tool registry so workflows can
  // reference MCP tool_ids (e.g., "qbo_accounts_list") directly. The registry
  // routes them through the run_MCP bridge.
  const allTools = await aggregator.getAllTools();
  const serverMap = aggregator.getToolServerMap();
  for (const tool of allTools) {
    // Skip tools that already exist as native tools (run_MCP, workflow_start, workflow_end)
    if (["run_MCP", "workflow_start", "workflow_end"].includes(tool.name)) continue;
    const serverName = serverMap.get(tool.name) ?? "unknown";
    registerMcpTool(tool.name, serverName, tool.description);
  }
  console.log(`[MCP] Registered ${allTools.length} tools into workflow registry`);

  initialized = true;
  console.log(`[MCP] Aggregator ready — ${aggregator.serverCount()} servers registered`);
}

export { aggregator };
