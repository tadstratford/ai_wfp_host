import type { WidgetDefinition } from "@shared/types/widgetTypes";

/**
 * Validate a widget's `data` payload against its JSON-Schema subset (type,
 * required, properties, items). Returns human-readable error strings; empty
 * means valid. No external dependency — just enough to catch the malformed
 * payloads an LLM-generated tool can produce (e.g. a missing `amounts` array).
 */

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

export function validateWidgetData(def: WidgetDefinition, data: unknown): string[] {
  const errors: string[] = [];
  walk(data, def.schema as JsonSchema, "$", errors);
  return errors;
}

function walk(value: unknown, schema: JsonSchema | undefined, path: string, errors: string[]): void {
  if (!schema) return;

  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push(`${path} should be ${schema.type}, got ${describe(value)}`);
    return;
  }

  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj) || obj[key] === undefined) {
        errors.push(`${path}.${key} is required`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) {
        walk(obj[key], propSchema, `${path}.${key}`, errors);
      }
    }
  } else if (schema.type === "array" && Array.isArray(value)) {
    const items = schema.items;
    if (items) {
      (value as unknown[]).forEach((item, i) => walk(item, items, `${path}[${i}]`, errors));
    }
  }
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
