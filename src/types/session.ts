import type { TableContent, ChartContent, FormContent } from "./rich";

export type SessionStatus =
  | "pending"
  | "in_progress"
  | "awaiting_feedback"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "blocked";

export type SessionKind = "automation" | "chat";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "error"
  | "info"
  | "audit"
  | "form"
  | "todo"
  | "chat_msg_sent";

export interface Message {
  id: string;
  role: MessageRole;
  timestamp: string;
  markdown?: string;
  html?: string;
  voice?: string;
  node_id?: string;
  node_label?: string;
  tool_id?: string;
  json?: Record<string, unknown>;
  data?: unknown[];
  table?: TableContent;
  chart?: ChartContent;
  form?: FormContent;
}

export type ParameterType =
  | "string" | "number" | "boolean" | "object" | "array";

export interface SessionParameter {
  name: string;
  type: ParameterType;
  value: unknown;
  required?: boolean;
  default?: unknown;
}

export interface Session {
  id: string;
  name?: string;
  workflow_id?: string;
  kind?: SessionKind;
  status: SessionStatus;
  messages?: Message[];
  parameters?: SessionParameter[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
