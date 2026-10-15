import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWs, getDatabaseId } from "../scope";
import { createSession, saveSession, getSession } from "@backend/core/session/sessions/session_all";
import { executeWorkflow } from "@backend/core/workflow";
import { getRunDepth, getRunSessionId, MAX_WORKFLOW_DEPTH } from "@backend/core/workflow/runContext";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { setParameterValue } from "@backend/core/settings/parameterHelpers";
import { autoWrap } from "wfp-api";
import { linkEmailSession, tagEmailWorkflow } from "@backend/core/workspace/emailInbox";

export default defineTool({
  name: "run_workflow",
  description: "Runs a workflow in a new session, seeding the given parameters, and returns the session id for viewing. Set wait=false to run in the background (fire-and-forget).",
  class: "control",
  output: { metaType: "text", tabular: false },
  mutating: true,
  durable: true,
  inputSchema: {
    workflow_id: z.string().describe("Workflow ID to run"),
    parameters: z.string().optional().describe("JSON object of initial parameters (e.g. {\"email_id\":\"...\"})"),
    name: z.string().optional().describe("Session name (defaults to the workflow name)"),
    email_id: z.string().optional().describe("If this run processes an inbound email, pass its email_id to link and tag it."),
    wait: z.boolean().optional().describe("Wait for the workflow to finish before returning (default true). false = run in the background and return immediately."),
  },
  handler: async ({ workflow_id, parameters, name, email_id, wait }) => {
    const ws = requireWs();
    const wf = ws.getWorkflow(workflow_id);
    if (!wf) {
      return { content: [{ type: "text" as const, text: `Workflow "${workflow_id}" not found.` }], isError: true };
    }

    const parentDepth = getRunDepth();
    if (parentDepth >= MAX_WORKFLOW_DEPTH) {
      return {
        content: [{ type: "text" as const, text: `Cannot run workflow "${wf.name}": maximum workflow nesting depth (${MAX_WORKFLOW_DEPTH}) exceeded.` }],
        isError: true,
      };
    }

    let params: Record<string, unknown> = {};
    if (parameters) {
      try {
        params = JSON.parse(parameters);
      } catch {
        return { content: [{ type: "text" as const, text: "Invalid JSON for parameters." }], isError: true };
      }
    }

    const databaseId = getDatabaseId()!;
    const userId = ws.userId;
    const session = await createSession(databaseId, userId, name || wf.name || "Workflow run");
    session.activeWorkflowId = workflow_id;

    let seeded = session.parameters ?? [];
    for (const [key, value] of Object.entries(params)) {
      seeded = setParameterValue(seeded, key, autoWrap(value));
    }
    session.parameters = seeded;

    session.metadata = { ...(session.metadata ?? {}), run_depth: parentDepth + 1 };

    await saveSession(databaseId, session);

    const parentSessionId = getRunSessionId();

    const run = async (notifyParent: boolean) => {
      try {
        await executeWorkflow(databaseId, workflow_id, session.session_id, name || wf.name || "Workflow run", session);

        if (email_id) {
          try {
            await linkEmailSession(email_id, session.session_id);
            await tagEmailWorkflow(email_id, { workflowId: workflow_id, workflowName: wf.name });
          } catch (err) {
            console.error(`[workflows] email link failed for ${email_id}:`, err);
          }
        }

        if (notifyParent && parentSessionId && parentSessionId !== session.session_id) {
          const parent = await getSession(databaseId, parentSessionId);
          if (parent) {
            parent.messages.push({
              id: `msg-${Date.now()}`,
              role: "assistant" as const,
              source: "run_workflow",
              html: `<div>Child workflow <strong>${wf.name}</strong> completed — <a href="/app/session?session_id=${session.session_id}&action=view">view report</a></div>`,
              markdown: `Child workflow **${wf.name}** completed — session ${session.session_id}`,
              timestamp: new Date(),
            } as any);
            await saveSession(databaseId, parent);
            notifyClients(parentSessionId, "new_message");
          }
        }
      } catch (err) {
        console.error(`[workflows] workflow run failed for ${workflow_id}:`, err);
      }
    };

    if (wait === false) {
      run(true);
      return { content: [{ type: "text" as const, text: JSON.stringify({ session_id: session.session_id, status: "started" }) }] };
    }

    await run(false);
    return { content: [{ type: "text" as const, text: JSON.stringify({ session_id: session.session_id, status: "completed" }) }] };
  },
});
