// MCP tool policy for `api.mcp` / `api.callMcp` in workflow tool code.
//
// Workflow tools run with broad host access (api.fetch, api.setData), so
// exposing the *internal control* MCP tools (delete_data, build_workflow,
// delete_rule, send_email, qbo_journal_create, …) would widen the blast
// radius for no benefit.
//
// Policy: default-deny. Every capability declares each tool's class in its
// manifest (`read` / `constructive-write` are callable from custom tool code;
// `destructive-write` / `control` are not). This is the single source of truth.
// The legacy allowlists below are empty and retained only for the two
// context-bound servers (sessions, build) that are not capabilities.
//
// Writes are gated by the chat write-approval gate (they live in WRITE_TOOLS in
// the orchestrator) and, in a saved workflow, by the user explicitly running it.

import { hasTool, isAllowedFromCustomCode } from "../capabilities/registry";

const READ_ALLOWLIST = new Set<string>([]);

const WRITE_ALLOWLIST = new Set<string>([]);

/** True when a workflow tool may call the given (exported) MCP tool name. */
export function isMcpToolAllowed(toolName: string): boolean {
  if (hasTool(toolName)) {
    return isAllowedFromCustomCode(toolName);
  }
  return READ_ALLOWLIST.has(toolName) || WRITE_ALLOWLIST.has(toolName);
}
