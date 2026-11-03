/**
 * Shared deterministic tool rosters for the plan path.
 *
 * These mirror vers_8's lists and are the boundary the planner sees: the routed
 * skills' declared tools plus the composable primitives (never the full
 * capability surface). Keeping them in one place lets the planner and the
 * re-plan recovery share the same vocabulary.
 */

/** The focused roster the planner picks from — narrow enough that a one-shot
 *  LLM plan isn't diluted by ~40 irrelevant tools (QBO reads, rules CRUD, …). */
export const COMPOSABLE_PRIMITIVES = [
  "get_data", "list_data", "resolve_data_shape", "aggregate_data", "judge_data",
  "check_data", "compare_data", "save_data", "set_param", "get_param",
  "reconcile_relationship", "list_relationships", "profile_data", "classify_data",
  "split_data", "report_table", "chat_download", "show_message",
  "export_workbook", "view_workbook",
];
