/**
 * Reporting Types
 * Types for the central reporting fact table and reporting manager
 * Following conventions: async functions, no classes, types in backend/types
 */

/**
 * Complete reporting fact record (database row)
 */
export interface ReportingFact {
    // Identity
    fact_id: string;
    database_id: string;

    // Session / Workflow Instance
    session_id: string;
    session_name: string | null;
    workflow_id: string | null;
    workflow_name: string | null;
    workflow_type: 'chat' | 'automation' | null;

    // Client Dimension (Practice Management) - INTEGER or STRING in database
    client_id: number | null;
    client_name: string | null;

    // Step Details
    step_name: string | null;
    step_order: number | null;
    node_id: string | null;
    tool_id: string | null;

    // User Dimension
    user_id: string | null;
    user_name: string | null;
    /** @deprecated kept for backward compat with old data */
    user_role: string | null;
    hourly_rate: number;

    // Department & rate tracking (added in migration 006)
    department_id: string | null;
    department_name: string | null;
    /** Department blended rate at time of execution (snapshotted) */
    budget_rate: number;
    /** Person who actually performed the step */
    actual_user_id: string | null;
    actual_user_name: string | null;

    // Time Dimension
    month: string | null; // YYYY-MM
    planned_start_date: string | null; // YYYY-MM-DD
    actual_start: string | null; // DATETIME
    actual_end: string | null; // DATETIME

    // Hours Metrics
    budget_hours: number;
    actual_hours: number;
    actual_duration_hours: number;
    variance_hours: number;

    // SLA & Compliance Metrics (NEW)
    sla_deadline_hours: number | null;
    deadline_at: string | null;
    response_time_hours: number | null;
    is_compliant: number; // 0 or 1

    // Dollar Metrics (Calculated)
    budget_dollars: number;
    actual_dollars: number;

    // Status and Approvals
    status: string | null; // pending, in_progress, waiting_approval, completed, rejected, cancelled
    approval_status: 'pending' | 'approved' | 'declined' | null;
    approver_id: string | null;
    approver_name: string | null;
    approval_requested_at: string | null; // DATETIME
    approval_responded_at: string | null; // DATETIME

    // Notification Tracking
    notification_sent: number; // 0 or 1
    notification_sent_at: string | null; // DATETIME

    // Metadata
    synced_at: string; // DATETIME
}

/**
 * Input data for upserting reporting facts
 * All calculated fields are optional (will be computed)
 */
export interface ReportingFactInput {
    // Identity (required)
    fact_id?: string; // Auto-generated if not provided
    database_id: string;

    // Session / Workflow Instance (required)
    session_id: string;
    session_name?: string | null;
    workflow_id?: string | null;
    workflow_name?: string | null;
    workflow_type?: 'chat' | 'automation' | null;

    client_id?: number | null;
    client_name?: string | null;

    // Step Details
    step_name?: string | null;
    step_order?: number | null;
    node_id?: string | null;
    tool_id?: string | null;
    // User Dimension
    user_id?: string | null;
    user_name?: string | null;
    /** @deprecated no longer written; kept for rebuild compat */
    user_role?: string | null;
    hourly_rate?: number; // legacy; use budget_rate / user_rate instead

    // Department & rate tracking (migration 006)
    department_id?: string | null;
    department_name?: string | null;
    /** Department blended rate (snapshotted); auto-resolved from department_id if absent */
    budget_rate?: number;
    /** Person who actually performed the step */
    actual_user_id?: string | null;
    actual_user_name?: string | null;

    // Time Dimension
    month?: string | null;
    planned_start_date?: string | null;
    actual_start?: Date | string | null;
    actual_end?: Date | string | null;

    // Hours Metrics
    budget_hours?: number;
    actual_hours?: number;
    actual_duration_hours?: number; // Auto-calculated from actual_start/end
    variance_hours?: number; // Auto-calculated as actual - budget

    // SLA & Compliance Metrics (NEW)
    sla_deadline_hours?: number | null;
    deadline_at?: Date | string | null;
    response_time_hours?: number | null;
    is_compliant?: number; // 0 or 1

    // Dollar Metrics (Auto-calculated)
    budget_dollars?: number;   // budget_hours × budget_rate (dept rate)
    actual_dollars?: number;   // actual_hours × doer_rate (individual performer rate)
    variance_dollars?: number; // budget_dollars - actual_dollars
    doer_rate?: number;        // hourly rate of the person who performed the step

    // Status and Approvals
    status?: string | null;
    approval_status?: 'pending' | 'approved' | 'declined' | null;
    approver_id?: string | null;
    approver_name?: string | null;
    approval_requested_at?: Date | string | null;
    approval_responded_at?: Date | string | null;

    // Notification Tracking
    notification_sent?: number;
    notification_sent_at?: Date | string | null;
}

/**
 * Approval-specific update data
 */
export interface ApprovalUpdate {
    approval_status: 'pending' | 'approved' | 'declined';
    approver_id?: string;
    approver_name?: string;
    approval_requested_at?: Date | string;
    approval_responded_at?: Date | string;
}

/**
 * Filter for querying/deleting facts
 */
export interface FactFilter {
    fact_id?: string;
    database_id?: string;
    session_id?: string;
    workflow_id?: string;
    client_id?: number;
    user_id?: string;
    status?: string;
    approval_status?: 'pending' | 'approved' | 'declined';
}

/**
 * Aggregated metrics for dashboards
 */
export interface ReportingMetrics {
    total_budget_hours: number;
    total_actual_hours: number;
    total_budget_dollars: number;
    total_actual_dollars: number;
    variance_hours: number;
    variance_dollars: number;
    utilization_rate: number; // actual / budget
    record_count: number;
}

/**
 * User-Month metrics for capacity planning
 */
export interface UserMonthMetrics {
    user_id: string;
    user_name: string;
    month: string;
    total_budget_hours: number;
    total_actual_hours: number;
    total_budget_dollars: number;
    total_actual_dollars: number;
    workflow_count: number;
}

/**
 * Client-Month metrics for profitability
 */
export interface ClientMonthMetrics {
    client_id: number;
    client_name: string;
    month: string;
    total_budget_hours: number;
    total_actual_hours: number;
    total_budget_dollars: number;
    total_actual_dollars: number;
    workflow_count: number;
}

/**
 * Workflow performance metrics
 */
export interface WorkflowMetrics {
    workflow_id: string;
    workflow_name: string;
    total_runs: number;
    avg_completion_hours: number;
    avg_budget_hours: number;
    avg_actual_hours: number;
    approval_rate: number; // % of steps approved vs declined
    on_time_rate: number; // % completed within budget
}
