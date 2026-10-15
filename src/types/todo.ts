export type TodoStatus = "pending" | "in_progress" | "done" | "cancelled";

export type TodoType = "triage" | "manual" | "workflow";

export interface TodoEntry {
  id?: string;
  label: string;
  instruction?: string;
  status: TodoStatus;
  type?: TodoType;
  workflow_id?: string;
  instance_name?: string;
  creating_workflow?: string;
  tag?: string;
  due_date?: string;
  notes?: string;
  hours?: number;
  sort_order?: number;
  source?: string;
  category?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TodoBuckets {
  plan: TodoEntry[];
  workflow: TodoEntry[];
  other: TodoEntry[];
}
