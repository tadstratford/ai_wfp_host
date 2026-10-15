/**
 * Unified tool parameter schema lookup.
 *
 * The chat loop executes tools through the MCP aggregator, whose tools expose
 * their input schema as JSON Schema (`inputSchema`). Native workflow tools
 * expose `ToolDefinition.inputs`. This module normalizes both into a flat
 * `ToolParam[]` list so the extractor has one shape to work with.
 */

import { aggregator } from "../../mcp/aggregator";
import { getToolDefinition } from "../../core/tools/registry";

export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
}

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  const?: unknown;
};

let cachedTools: Map<string, ToolParam[]> | null = null;
let cachedSchemas: Map<string, JsonSchema> = new Map();

/** Populate the flat-param and raw-schema indexes from the MCP aggregator. */
async function ensureIndex(): Promise<void> {
  if (cachedTools) return;
  cachedTools = new Map();
  try {
    const tools = await aggregator.getAllTools();
    for (const t of tools) {
      const schema = t.inputSchema as JsonSchema;
      cachedTools.set(t.name, normalizeSchema(schema));
      cachedSchemas.set(t.name, schema);
    }
  } catch (err: any) {
    console.warn(`[extract] Failed to load MCP tool schemas: ${err.message}`);
  }
}

function enumFrom(schema: JsonSchema): string[] | undefined {
  if (Array.isArray(schema.enum)) return schema.enum.map(String);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    if (branch.const !== undefined) return [String(branch.const)];
  }
  return undefined;
}

function normalizeSchema(schema: JsonSchema): ToolParam[] {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const params: ToolParam[] = [];
  for (const [name, p] of Object.entries(props)) {
    let type: ToolParam["type"] = "string";
    if (p?.type === "number" || p?.type === "integer") type = "number";
    else if (p?.type === "boolean") type = "boolean";
    else if (p?.type === "object") type = "object";
    else if (p?.type === "array") type = "array";

    params.push({
      name,
      type,
      required: required.has(name),
      description: p?.description,
      enum: enumFrom(p),
      default: p?.default,
    });
  }
  return params;
}

/** Reload the tool→params index from the MCP aggregator (native fallback on demand). */
export async function getToolParams(toolId: string): Promise<ToolParam[]> {
  await ensureIndex();

  const hit = cachedTools!.get(toolId);
  if (hit) return hit;

  // Fallback: native workflow tools not exposed through the aggregator.
  try {
    const def = await getToolDefinition(toolId);
    if (def?.inputs?.length) {
      const params = def.inputs.map((i) => ({
        name: i.name,
        type: (i.type === "filepath" ? "string" : i.type) as ToolParam["type"],
        required: !!i.required,
        description: i.description,
        enum: i.enum,
        default: i.default,
      }));
      cachedTools!.set(toolId, params);
      return params;
    }
  } catch (err: any) {
    console.warn(`[extract] getToolDefinition failed for ${toolId}: ${err.message}`);
  }

  return [];
}

/** The tool's raw JSON Schema (unflattened), for filling structured args. */
export async function getToolSchema(toolId: string): Promise<JsonSchema | undefined> {
  await ensureIndex();
  return cachedSchemas.get(toolId);
}

/** Reset the cached schema index (e.g. after MCP servers register late). */
export function clearToolParamsCache(): void {
  cachedTools = null;
  cachedSchemas = new Map();
}
