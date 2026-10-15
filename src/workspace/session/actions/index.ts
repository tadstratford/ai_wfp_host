import { v4 as uuidv4 } from "uuid";
import { Session, Message } from "@backend/types";
import { saveSession } from "../sessions/session_all";

/**
 * Update session with parameter values from form submission
 */
export const updateSessionWithParameterValues = async (
  databaseId: string,
  session: Session,
  parameterValues: Record<string, Record<string, any>>
): Promise<Session> => {
  console.log(
    "[Session Manager] Updating session with parameter values:",
    parameterValues
  );

  // Update the active workflow execution's nodes with the provided parameter values
  const activeExec = session.activeWorkflowId ? session.workflows?.[session.activeWorkflowId] : null;
  if (activeExec && activeExec.nodes.length > 0) {
    activeExec.nodes = activeExec.nodes.map((action) => {
      if (!action.tool_id) {
        return action;
      }
      const toolParams = parameterValues[action.tool_id];
      if (toolParams) {
        console.log(
          `[Session Manager] Updating action ${action.tool_id} with params:`,
          toolParams
        );
        return {
          ...action,
          tool_parameters: { ...action.tool_parameters, ...toolParams },
        };
      }
      return action;
    });
  }

  // Add a system message indicating parameters were submitted
  const parameterMessage: Message = {
    id: uuidv4(),
    role: "audit",
    source: "tool",
    html: `Parameters submitted: ${Object.keys(parameterValues).join(", ")}`,
    data: [parameterValues],
    json: { parameterValues },
    timestamp: new Date(),
  };

  session.messages = [...(session.messages || []), parameterMessage];

  await saveSession(databaseId, session);

  console.log("[Session Manager] Session updated with parameter values");
  return session;
};
