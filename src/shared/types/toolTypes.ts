/**
 * Tool API Version
 * Major version must match between tools and core for compatibility
 * Increment major version for breaking changes
 */
export const TOOL_API_VERSION = "1.0.0";

/**
 * Check if a tool's API version is compatible with the core version
 * @param toolVersion - Tool's declared API version
 * @param coreVersion - Core's current API version
 * @returns true if compatible (major versions match)
 */
export function isCompatibleVersion(
  toolVersion: string,
  coreVersion: string
): boolean {
  const [toolMajor] = toolVersion.split(".").map(Number);
  const [coreMajor] = coreVersion.split(".").map(Number);

  // Major version must match (breaking changes)
  return toolMajor === coreMajor;
}

// Tool Parameter definition - simplified for cleaner parameter handling
export interface ToolInput {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "filepath";
  required?: boolean;
  description?: string;
  default?: any;
  enum?: string[]; // Dropdown options for string/number types
  value: any;
}

// Output field specification
export interface ToolOutput {
  name: string;  // e.g., "content", "json", "data"
  type: "string" | "object" | "array" | "boolean" | "number";
  description?: string;
  example?: any;
}

// // Output schema - documents what data the tool produces
// export interface ToolOutputSchema {
//   fields: ToolOutputField[];
//   description?: string;
// }

// // Test case structure
// export interface ToolTestCase {
//   name: string;
//   description?: string;
//   config: Record<string, any>;      // Configuration parameter values
//   runtime: Record<string, any>;     // Runtime parameter values
//   expectedOutput?: {
//     messageRole?: "tool" | "assistant" | "error";
//     contentContains?: string;
//     shouldHaveJson?: boolean;
//     shouldHaveData?: boolean;
//   };
// }

// export type ToolOutput = "json" | "markdown" | "html" | "data" | "file";

// // Tool Catalog Entry - used for catalog display
// export interface ToolCatalogEntry {
//   tool_id: string;
//   name: string;
//   description: string;
//   parameters?: ToolParameter[];
//   test_parameters?: ToolParameter[];
// }

// Main tool interface - used in database and JSON files
export interface ToolDefinition {
  tool_id: string;
  name: string;
  description: string;
  category: string;
  color?: string; // Optional override color for the category dot (e.g., "#6366f1")
  apiVersion: string; // Semantic version (e.g., "1.0.0")
  inputs: ToolInput[];
  outputs: ToolOutput[];
  allow_custom_code?: boolean;
  description_md?: string; // Rich markdown description for the tools library
  chatRunnable?: boolean; // Tool can be executed directly from chat via tool.run
  knowledgePacks?: string[]; // Names of knowledge packs that informed this tool's design
}
