/**
 * Shared MCP type vocabulary — single source of truth for type schemas
 * used across all app-wfp-* MCP servers.
 *
 * Mirrors the WFP typed envelope MetaType vocabulary from the wfp-api spec.
 * Every tool that accepts or returns typed data uses these constants so
 * the LLM gets a consistent type language regardless of which server it
 *  is talking to.
 */

import type { MetaType } from "wfp-api";

export const WFP_META_TYPES = [
  "string",
  "number",
  "boolean",
  "csv",
  "json_array",
  "json_object",
  "json_cells",
  "text",
] as const satisfies readonly MetaType[];

export type WfpMetaType = (typeof WFP_META_TYPES)[number];

// Compile-time check: this tuple must be exactly the canonical MetaType set
// (defined in src/shared/wfp-api/types.ts). If either list drifts, typecheck
// fails here rather than silently diverging.
type _AssertMetaTypesMatch = [MetaType] extends [WfpMetaType]
  ? [WfpMetaType] extends [MetaType]
    ? true
    : never
  : never;

export const WFP_TYPE_HINT: Record<WfpMetaType, string> = {
  string:      "Plain text, names, identifiers. Pass the text directly.",
  number:      "Numeric values — monetary amounts, counts, IDs. Pass digits as a string: '456' or '1500.00'.",
  boolean:     "Flags and switches. Pass 'true' or 'false'.",
  csv:         "Tabular data from CSV. Same shape as json_array, but marks CSV origin. Use columns[] and rowCount.",
  json_array:  "Array of objects — table / list data. Pass a JSON array string. Provide columns[] and rowCount.",
  json_object: "Single key/value record. Pass a JSON object string: '{\"key\": \"val\"}'.",
  json_cells:  "Raw sheet as a cell-address map ({a1: value, b2: value, …}). Empty cells are omitted. Use for formatted/multi-table reports where row addresses matter.",
  text:        "Multi-line text, HTML content, or formatted documents.",
};
