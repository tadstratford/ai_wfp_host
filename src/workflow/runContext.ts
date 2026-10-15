/**
 * Run context — request-scoped facts a nested `run_workflow` needs to know.
 *
 * Mirrors the module-level "current database / session" pattern the MCP servers
 * already use, but for the two pieces of information workflow *composition*
 * needs:
 *   1. the nesting depth of the currently-executing workflow (to cap recursion), and
 *   2. the session id of the caller (to report a child's completion back).
 *
 * The workflow executor sets these around each run; the chat orchestrator sets
 * depth = 0 + the chat session id. `run_workflow` (app-wfp-workflows) reads them
 * to seed the child session and report back to the parent.
 */

/** Maximum number of nested `run_workflow` calls allowed (0 = top-level chat). */
export const MAX_WORKFLOW_DEPTH = 5;

let currentDepth = 0;
let currentSessionId: string | null = null;

export function getRunDepth(): number {
  return currentDepth;
}

export function setRunDepth(depth: number): void {
  currentDepth = depth;
}

export function getRunSessionId(): string | null {
  return currentSessionId;
}

export function setRunSessionId(id: string | null): void {
  currentSessionId = id;
}
