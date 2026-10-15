// Workflow types for the hosted app.
//
// The .wfp 1.0.0 spec types (Workflow, Node, NodeKind, WorkflowKind) are
// re-exported from the shared `wfp-format` package — see
// ../../../wfp_format/README.md for the canonical spec.
//
// Hosted-app-only types live below: the WorkflowMgmt_* groups that decorate
// a Node's optional `workflow_mgmt` field with approval / budget / email /
// chat-message metadata. The spec's WorkflowMgmt is an open object — these
// types just give the hosted app strongly-typed access to its known fields.

export type {
  Workflow,
  Node,
  Node as WorkflowNode,
  NodeKind,
  NodeKind as WorkflowNodeType,
  WorkflowKind,
} from "wfp-format";

// ── Hosted-app-only node management metadata ────────────────────────────────

// Approvals & Staff
export interface WorkflowMgmt_Approvals {
  requires_approval?: boolean;
  approver_email?: string;
  approver_role?: string;
  approval_message?: string;
}

// Budget & Time & Assignment
export interface WorkflowMgmt_Budget {
  department_name?: string;
  department_id?: string;
  sla_hours?: number;
  budgeted_hours?: number;
}

// Email Integration
export interface WorkflowMgmt_Email {
  send_email?: boolean;
  email_to?: string;
  email_subject?: string;
  email_body?: string;
}

// Chat Message
export interface WorkflowMgmt_ChatMsg {
  chat_msg?: string;
}

export type WorkflowMgmtAll =
  & WorkflowMgmt_Approvals
  & WorkflowMgmt_Budget
  & WorkflowMgmt_Email
  & WorkflowMgmt_ChatMsg;
