export type WorkflowKind = "automation" | "chat";

export type NodeKind = "start" | "end" | "tool" | "prompt";

export type BuiltinToolId =
  | "workflow_start"
  | "workflow_end"
  | "chat_download";

export const BUILTIN_TOOL_IDS: ReadonlySet<BuiltinToolId> = new Set([
  "workflow_start",
  "workflow_end",
  "chat_download",
]);

export interface WorkflowMgmt {
  requires_approval?: boolean;
  approver_email?: string;
  approver_role?: string;
  approval_message?: string;
  send_email?: boolean;
  email_to?: string;
  email_subject?: string;
  email_body?: string;
  chat_msg?: string;
  sla_hours?: number;
  budgeted_hours?: number;
}

export interface Node {
  id: string;
  type: NodeKind;
  label: string;
  step_order: number;
  tool_id: string;
  tool_config?: Record<string, unknown>;
  tool_parameters?: Record<string, unknown>;
  workflow_mgmt?: WorkflowMgmt;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  type?: WorkflowKind;
  group?: string;
  nodes: Node[];
  summary?: string;
  sort_order?: number;
  depends_on?: string[];
  created_at?: string;
  updated_at?: string;
}
