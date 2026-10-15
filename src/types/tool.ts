export type ToolInputType =
  | "string" | "number" | "boolean" | "object" | "array" | "filepath";

export type ToolOutputType =
  | "string" | "number" | "boolean" | "object" | "array";

export interface ToolInput {
  name: string;
  type: ToolInputType;
  required?: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface ToolOutput {
  name: string;
  type: ToolOutputType;
  description?: string;
  example?: unknown;
}

export interface Tool {
  tool_id: string;
  name: string;
  description: string;
  description_md?: string;
  category?: string;
  color?: string;
  api_version: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
  code: string;
  allow_custom_code?: boolean;
  chat_runnable?: boolean;
  knowledgePacks?: string[];
  created_at?: string;
  updated_at?: string;
}
