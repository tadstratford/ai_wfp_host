/**
 * `defineTool` — the single declaration for a capability tool.
 *
 * One file under `capabilities/<name>/tools/*.ts` exports one tool via
 * `export default defineTool({...})`. The loader auto-discovers these with
 * `import.meta.glob`, registers each into the capability's McpServer, and the
 * capability registry derives the tool policy (class), output contract, and
 * chat-orchestration flags (mutating / durable / report) from the same object.
 */

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolClass, ToolOutputContract, ToolDef } from "./types";

export function defineTool<const Args extends ZodRawShapeCompat>(
  def: {
    name: string;
    description: string;
    inputSchema?: Args;
    class: ToolClass;
    output?: ToolOutputContract;
    mutating?: boolean;
    durable?: boolean;
    report?: boolean;
    handler: ToolCallback<Args>;
  },
): ToolDef {
  return def as unknown as ToolDef;
}
