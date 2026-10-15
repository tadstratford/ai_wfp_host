/**
 * Build-Test-Fix Loop
 *
 * After the workflow builder creates a workflow, this module:
 * 1. Creates a temporary test session
 * 2. Runs the workflow
 * 3. Checks for errors
 * 4. If errors, returns the error details for the builder to fix
 * 5. Cleans up the test session
 *
 * The caller (process manager) feeds the errors back to the LLM
 * and lets it fix the code, then re-tests. Max 2 retries.
 */

import { createSession, deleteSession } from "@backend/core/session/sessions/session_all";
import { executeWorkflow } from "@backend/core/workflow/executeWorkflow";
import { getWorkflowById } from "@backend/core/workflow/getWorkflowbyId";
import type { Session } from "@backend/types";

export interface BuildTestResult {
  success: boolean;
  /** Error messages from tool execution failures */
  errors: string[];
  /** Which step/node failed */
  failedStep?: string;
  /** The full error detail for the builder to use in fixing */
  errorDetail?: string;
}

/**
 * Check if a workflow can be auto-tested.
 *
 * Pause now happens via `api.pauseForInput` from arbitrary custom tool code,
 * not a specific built-in, so we can no longer detect it from the node
 * graph alone. Conservatively allow auto-test for everything; if a tool
 * does pause at runtime, the executor handles it cleanly.
 *
 * Exception: email workflows (nodes referencing the email tools) are skipped.
 * They need the seeded `email_*` params that only exist in a real inbound run,
 * and `send_email` would fire a real outbound email during the test.
 */
const EMAIL_TOOL_IDS = new Set([
  "send_email",
  "email_get",
  "email_list",
  "email_set_status",
  "email_delete",
]);

export async function canAutoTest(databaseId: string, workflowId: string): Promise<boolean> {
  const workflow = await getWorkflowById(databaseId, workflowId);
  if (!workflow || !workflow.nodes) return false;
  if (workflow.nodes.some((n: any) => EMAIL_TOOL_IDS.has(n.tool_id))) return false;
  return true;
}

/**
 * Run a workflow in a temporary test session and check for errors.
 * Returns success or error details. Always cleans up the test session.
 */
export async function testWorkflow(
  databaseId: string,
  workflowId: string,
  userId: string,
): Promise<BuildTestResult> {
  let testSession: Session | null = null;

  try {
    // Create a temporary test session
    testSession = await createSession(databaseId, userId, `__test_${workflowId}`);

    // Run the workflow
    const result = await executeWorkflow(
      databaseId,
      workflowId,
      testSession.session_id,
      "Automated test run",
      undefined,
      { skipToolIds: ["workflow_audit"] },
    );

    // Check for errors in the session messages
    const errorMessages = result.messages.filter(
      (m) => m.role === "error" || m.json?.error
    );

    if (errorMessages.length > 0) {
      const errors = errorMessages.map((m) => {
        const toolId = m.json?.toolId || m.source || "unknown";
        const errorMsg = m.json?.error || m.markdown || "Unknown error";
        return `${toolId}: ${errorMsg}`;
      });

      const firstError = errorMessages[0];
      return {
        success: false,
        errors,
        failedStep: firstError.nodeLabel || firstError.source || undefined,
        errorDetail: errors.join("\n"),
      };
    }

    // Check for data quality issues in tool output (undefined, NaN)
    const toolMessages = result.messages.filter((m) => m.role === "tool");
    const qualityIssues: string[] = [];
    for (const msg of toolMessages) {
      const content = msg.html || msg.markdown || "";
      if (content.includes("undefined") || content.includes("NaN") || content.includes("$NaN")) {
        qualityIssues.push(
          `Step "${msg.nodeLabel || msg.source}": output contains undefined or NaN values — likely a column name mismatch`
        );
      }
    }

    if (qualityIssues.length > 0) {
      return {
        success: false,
        errors: qualityIssues,
        errorDetail: qualityIssues.join("\n"),
      };
    }

    return { success: true, errors: [] };
  } catch (err: any) {
    return {
      success: false,
      errors: [err.message || String(err)],
      errorDetail: err.message || String(err),
    };
  } finally {
    // Always clean up the test session
    if (testSession) {
      try {
        await deleteSession(databaseId, testSession.session_id);
      } catch { /* best effort cleanup */ }
    }
  }
}
