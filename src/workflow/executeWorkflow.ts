import { getSession, saveSession } from "@backend/core/session";
import { getWorkflowById } from "./getWorkflowbyId";
import { executeWorkflowActions } from "./executor";
import type { Session } from "@backend/types";
import { generateSessionSummary } from "@backend/core/context/summarize";

/**
 * Execute a workflow with session management
 *
 * @param workflowId - ID of the workflow to execute
 * @param sessionId - Session ID to use (required)
 * @param userMessage - User message to pass to workflow (stored in metadata.initialInput)
 * @returns Updated session with workflow execution results
 */
export const executeWorkflow = async (
  databaseId: string,
  workflowId: string,
  sessionId: string,
  userMessage: string = "Workflow execution",
  existingSession?: Session, // Optional: pass session to avoid race condition
  opts?: { skipToolIds?: string[] },
): Promise<Session> => {
  // Get existing session - use provided session or fetch from DB
  let session = existingSession || (await getSession(databaseId, sessionId));

  if (!session) {
    throw new Error(`Session ${sessionId} not found. Cannot execute workflow.`);
  }

  // Load workflow from database
  const workflow = await getWorkflowById(databaseId, workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // Optionally exclude specific tool nodes (e.g. skip the terminal audit during
  // an automated integration test so it doesn't pay for the LLM audit pass).
  const skip = opts?.skipToolIds ?? [];
  const effectiveWorkflow = skip.length > 0
    ? { ...workflow, nodes: workflow.nodes.filter((n: any) => !skip.includes(n.tool_id)) }
    : workflow;

  console.log(
    `[executeWorkflow] Starting workflow ${workflowId} for session ${session.session_id}`,
  );

  // Initialize workflows map if needed
  if (!session.workflows) session.workflows = {};

  // Check if this workflow already exists in the map
  const existingExecution = session.workflows[workflowId];

  if (existingExecution) {
    // Workflow already in progress or paused — always refresh nodes/edges from the live definition
    // so retries and resumes use the latest workflow structure, not a stale snapshot.
    console.log(
      `[executeWorkflow] Workflow ${workflowId} already exists, refreshing nodes/edges`,
    );
    existingExecution.nodes = JSON.parse(JSON.stringify(effectiveWorkflow.nodes));
    session.activeWorkflowId = workflowId;
  } else {
    // Create new workflow execution entry
    session.workflows[workflowId] = {
      workflowId: workflowId,
      workflowName: workflow.name,
      nodes: JSON.parse(JSON.stringify(effectiveWorkflow.nodes)), // Deep clone
      visitedNodes: [],
      startedAt: new Date(),
      metadata: {
        initialInput: userMessage,
        workflow_id: workflowId,
      },
    };
    session.activeWorkflowId = workflowId;

    // Add workflow execution start message
    session.messages.push({
      id: `msg-${Date.now()}`,
      role: "system",
      source: "workflow_executor",
      html: `<div class="workflow-execution">Starting workflow: <strong>${workflow.name}</strong></div>`,
      markdown: `Starting workflow: **${workflow.name}**`,
      timestamp: new Date(),
    });
  }

  // Save before execution so start message and snapshot are visible
  await saveSession(databaseId, session);

  // Execute workflow actions
  session = await executeWorkflowActions(databaseId, effectiveWorkflow, session);

  // Add completion message only if not paused
  const execution = session.workflows?.[workflowId];
  if (execution && !execution.pauseReason && !execution.completedAt) {
    execution.completedAt = new Date();

    session.messages.push({
      id: `msg-${Date.now()}`,
      role: "system",
      source: "workflow_executor",
      html: `<div class="workflow-execution">Workflow completed: <strong>${workflow.name}</strong></div>`,
      markdown: `Workflow completed: **${workflow.name}**`,
      timestamp: new Date(),
    });
  }

  // Save final state
  await saveSession(databaseId, session);

  // Generate session summary asynchronously — fire-and-forget
  const finalExecution = session.workflows?.[workflowId];
  const finalStatus = finalExecution?.pauseReason ? "paused" : "completed";
  const lastMessages = session.messages
    .slice(-8)
    .map((m) => m.markdown ?? "")
    .filter(Boolean);
  const finalParams = Object.fromEntries(
    (session.parameters ?? [])
      .filter((p: any) => !p.name.startsWith("__internal_"))
      .map((p: any) => [p.name, p.value]),
  );
  generateSessionSummary(
    databaseId,
    session.session_id,
    workflow.name,
    finalStatus,
    lastMessages,
    finalParams,
  ).catch(() => {});

  return session;
};
