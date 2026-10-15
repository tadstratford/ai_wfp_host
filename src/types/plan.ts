import type { TodoStatus } from "./todo";

export interface PlanEntry {
  id?: string;
  label: string;
  instruction: string;
  status: TodoStatus;
  source: "planner";
  category?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}
