/**
 * Output contract for the pre-built (MCP) tools the chat composer wires together.
 *
 * Thin wrapper over the MCP `resultContract` registry (src/mcp/outputs.ts),
 * which each server populates via `declareResult` when it registers its tools.
 */

import { resultContract } from "@mcp/outputs";

export interface ToolOutput {
  type: string;
  tabular: boolean;
}

/** The declared output of a tool, defaulting to an opaque JSON object. */
export function getToolOutput(toolId: string): ToolOutput {
  const c = resultContract(toolId);
  return { type: c.metaType, tabular: c.tabular };
}

/** The WFP type to persist a producer's output as (json_array when tabular). */
export function saveTypeFor(toolId: string): string {
  const out = getToolOutput(toolId);
  return out.tabular ? "json_array" : out.type;
}
