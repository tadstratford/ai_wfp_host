import { getSession } from "@backend/core/session/sessions/session_all";
import { getWorkflowById } from "@backend/core/workflow";
import type { Message } from "@backend/types";

/**
 * Build session context for the AI assistant to review a workflow run.
 * Returns { context, summary, sessionName, workflowId } or null if session not found.
 */
export async function buildSessionContext(
  databaseId: string,
  sessionId: string
): Promise<{
  context: string;
  summary: string;
  sessionName: string;
  workflowId: string | null;
} | null> {
  const session = await getSession(databaseId, sessionId);
  if (!session) return null;

  // Load workflow definition if available
  let workflowName = "";
  let workflowInfo = "";
  const workflowId = session.activeWorkflowId || null;

  if (workflowId) {
    const workflow = await getWorkflowById(databaseId, workflowId);
    if (workflow) {
      workflowName = workflow.name;
      const nodes = workflow.nodes || [];
      const nodeList = nodes
        .filter((n) => n.tool_id !== "workflow_start" && n.tool_id !== "workflow_end")
        .map((n, i) => `  ${i + 1}. "${n.label || "(no label)"}" — tool: ${n.tool_id || "unknown"}`)
        .join("\n");
      workflowInfo = `## Workflow: ${workflow.name}\nSteps:\n${nodeList}\n\n`;
    }
  }

  // Format messages — focus on outputs, errors, and info; skip noise
  const messages = (session.messages || []) as Message[];
  const relevantRoles = new Set(["tool", "error", "assistant", "info", "email_sent", "chat_msg_sent"]);
  const relevantMessages = messages.filter((m) => relevantRoles.has(m.role));

  // Cap at 40 messages to stay within token limits
  const capped = relevantMessages.slice(-40);
  const messageBlock = capped
    .map((m) => {
      const label = m.nodeLabel ? `[${m.nodeLabel}]` : "";
      const content = (m.markdown || m.html || "").slice(0, 600);
      const errorJson = m.role === "error" && m.json ? `\nError detail: ${JSON.stringify(m.json).slice(0, 400)}` : "";
      return `${m.role.toUpperCase()} ${label} (${m.toolName || m.source || ""})\n${content}${errorJson}`;
    })
    .join("\n---\n");

  // Session parameters
  let paramsBlock = "";
  const params = session.parameters || [];
  const visibleParams = (Array.isArray(params) ? params : []).filter(
    (p: any) => !p.name?.startsWith("__internal_")
  );
  if (visibleParams.length > 0) {
    paramsBlock =
      "## Parameters\n" +
      visibleParams.map((p: any) => `  ${p.name} = ${JSON.stringify(p.value).slice(0, 200)}`).join("\n") +
      "\n\n";
  }

  // Session status
  const status = session.instance_status || (messages.some((m) => m.role === "error") ? "error" : "completed");
  const hasErrors = messages.some((m) => m.role === "error");
  const errorCount = messages.filter((m) => m.role === "error").length;

  // Build context for the chat system prompt
  const context =
    `## Session Under Review\n\n` +
    `Session: "${session.sessionName || sessionId}"\n` +
    `Status: ${status}\n` +
    `Has errors: ${hasErrors ? `YES (${errorCount})` : "no"}\n` +
    `Message count: ${messages.length}\n\n` +
    workflowInfo +
    paramsBlock +
    `## Execution Messages\n${messageBlock || "(no messages recorded)"}`;

  // Build a short summary line for the initial chat message
  const stepCount = capped.filter((m) => m.role === "tool").length;
  const summaryParts = [workflowName || session.sessionName || "Session"];
  summaryParts.push(`${stepCount} step${stepCount !== 1 ? "s" : ""} executed`);
  if (hasErrors) summaryParts.push(`${errorCount} error${errorCount !== 1 ? "s" : ""}`);
  summaryParts.push(status);
  const summary = summaryParts.join(" — ");

  return {
    context,
    summary,
    sessionName: session.sessionName || sessionId,
    workflowId,
  };
}
