/**
 * Result contract for a tool — what its `result` value is (the WFP envelope
 * type) and whether it can be flattened to a flat table.
 *
 * MCP tools only declare an *input* schema (the SDK's `server.tool` has no
 * output slot), so each server declares its tools' results here (option 1:
 * extend tool registration with a real output contract). The chat composer
 * uses this to wire `{{result}}` between steps and to persist results with the
 * right envelope type.
 */

import type { MetaType } from "wfp-api";

export interface ResultContract {
  /** WFP envelope type of the tool's `result` (json_array, json_object, text, …). */
  metaType: MetaType;
  /** True when the result is a flat array of rows (flattenable to a table). */
  tabular: boolean;
}

const registry = new Map<string, ResultContract>();

export function declareResult(toolName: string, contract: ResultContract): void {
  registry.set(toolName, contract);
}

export function resultContract(toolName: string): ResultContract {
  return registry.get(toolName) ?? { metaType: "json_object", tabular: false };
}
