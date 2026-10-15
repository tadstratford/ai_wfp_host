import { callProvider } from "@backend/core/llm/providers";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { loadPrompt } from "@backend/core/chat/prompts/loader";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { maskText } from "@backend/core/knowledge/autoMask";

/** Mask a data preview (manual + automatic privacy maps) before it reaches the LLM. */
function maskPreview(databaseId: string, text: string): string {
  try {
    const forward = loadPrivacyMap(databaseId);
    if (!forward) return text;
    return maskText(text, forward);
  } catch {
    return text;
  }
}

/**
 * Generate a short summary string via a single Claude call.
 * Returns null if no API key is available or the call fails — never throws.
 */
async function generateSummary(
  prompt: string,
  databaseId: string
): Promise<string | null> {
  try {
    const result = await callProvider(
      databaseId,
      {
        system: loadPrompt("operational/summarizer"),
        messages: [{ role: "user", content: prompt }],
        maxTokens: 150,
      },
      { mode: "summarize" },
    );
    return result.text;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// User data summary
// ---------------------------------------------------------------------------

/**
 * Generate and store a summary for a user data file immediately after upload.
 * Called from loadUserData() — fire-and-forget (do not await in hot path).
 */
export async function generateUserDataSummary(
  databaseId: string,
  name: string,
  content: string
): Promise<void> {
  const rawPreview = content.slice(0, 600);
  const preview = maskPreview(databaseId, rawPreview);
  const isCSV = rawPreview.includes(",") && rawPreview.split("\n").length > 1;

  const prompt = isCSV
    ? `This is the start of a CSV file named "${name}":\n\n${preview}\n\nDescribe it in one sentence: how many columns, what they are, and what kind of data it contains.`
    : `This is the start of a file named "${name}":\n\n${preview}\n\nDescribe what this file contains in one sentence.`;

  const summary = await generateSummary(prompt, databaseId);
  if (!summary) return;

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return;
  const entry = session.getDataEntry(name);
  if (!entry) return;
  session.setDataEntry(name, { ...entry, summary } as any);
}

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

/**
 * Generate and store a summary for a session when it reaches a terminal/paused state.
 * Called from the workflow executor after status is set.
 * Fire-and-forget.
 */
export async function generateSessionSummary(
  databaseId: string,
  sessionId: string,
  workflowName: string,
  status: string,
  lastMessages: string[],
  finalParams: Record<string, any>
): Promise<void> {
  const messageBlock = lastMessages.slice(-6).join("\n").slice(0, 800);
  const paramKeys = Object.keys(finalParams)
    .filter((k) => !k.startsWith("__internal_"))
    .slice(0, 10)
    .join(", ");

  const prompt =
    `Workflow: "${workflowName}"\nFinal status: ${status}\n` +
    (paramKeys ? `Variables produced: ${paramKeys}\n` : "") +
    (messageBlock ? `Last chat output:\n${messageBlock}\n` : "") +
    `\nSummarise what this workflow run did and what it produced in 1–2 sentences.`;

  const summary = await generateSummary(prompt, databaseId);
  if (!summary) return;

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return;
  const wfpSession = session.getSession(sessionId);
  if (!wfpSession) return;
  session.upsertSession({ ...wfpSession, summary } as any);
}

// ---------------------------------------------------------------------------
// Workflow summary
// ---------------------------------------------------------------------------

/**
 * Generate and store both summary (plain text) and description (structured markdown)
 * for a workflow after significant node changes.
 */
export async function generateWorkflowSummary(
  databaseId: string,
  workflowId: string,
  workflowName: string,
  nodes: Array<{ tool_id: string; label: string }>
): Promise<void> {
  const nodeCount = nodes.length;
  const steps = nodes
    .filter((n) => n.tool_id !== "workflow_start" && n.tool_id !== "workflow_end")
    .map((n) => n.label || n.tool_id);
  const toolNames = steps.slice(0, 8).join(", ");
  const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return;
  const wf = session.getWorkflow(workflowId);
  if (!wf) return;

  // --- Summary (plain text, 1-2 sentences) ---
  let summary: string | null = null;
  if (nodeCount >= 3 && workflowName) {
    const prompt =
      `Workflow name: "${workflowName}"\n` +
      `Steps (${nodeCount} total): ${toolNames}\n\n` +
      `Write a practical 1–2 sentence summary explaining what this workflow does and when the user would run it. Focus on the purpose and outcome, not the step names.`;
    summary = await generateSummary(prompt, databaseId);
  }
  if (!summary) {
    summary =
      nodeCount <= 2
        ? `${workflowName} — ${nodeCount} node${nodeCount === 1 ? "" : "s"}, not yet configured.`
        : `${workflowName} — ${nodeCount} steps: ${toolNames}.`;
  }

  // --- Description (structured markdown) ---
  const existingDesc = wf.description ?? "";
  const hasRichDescription =
    existingDesc.includes("## Purpose") ||
    existingDesc.includes("## Inputs") ||
    existingDesc.includes("## Outputs");

  let description: string | null = null;
  if (hasRichDescription) {
    description = existingDesc;
  } else if (nodeCount >= 3 && workflowName) {
    description = await generateWorkflowDescription(databaseId, workflowName, stepList);
  }
  if (!description) {
    description =
      nodeCount <= 2
        ? `## ${workflowName}\n\nNot yet configured (${nodeCount} node${nodeCount === 1 ? "" : "s"}).`
        : `## ${workflowName}\n\n### Steps\n${stepList}`;
  }

  session.upsertWorkflow({
    ...wf,
    summary,
    description,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Generate a structured markdown description for a workflow via LLM.
 */
async function generateWorkflowDescription(
  databaseId: string,
  workflowName: string,
  stepList: string,
): Promise<string | null> {
  try {
    const result = await callProvider(
      databaseId,
      {
        system: loadPrompt("operational/workflow-description"),
        messages: [
          {
            role: "user",
            content:
              `Workflow: "${workflowName}"\n\nSteps:\n${stepList}\n\nGenerate the structured description.`,
          },
        ],
        maxTokens: 500,
      },
      { mode: "summarize" },
    );
    return result.text;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Workspace persona
// ---------------------------------------------------------------------------

/**
 * Auto-generate a workspace_persona from current workspace content.
 * Called when the user clicks "Generate" in the workspace panel, or on first workflow create.
 */
export async function generateWorkspaceSummary(
  databaseId: string,
  workspaceName: string,
  workflowSummaries: string[],
  toolNames: string[],
  dataFileSummaries: string[]
): Promise<string | null> {
  const parts: string[] = [`Workspace: "${workspaceName}"`];

  if (workflowSummaries.length > 0) {
    parts.push(`Workflows:\n${workflowSummaries.map((s) => `- ${s}`).join("\n")}`);
  }
  if (toolNames.length > 0) {
    parts.push(`Custom tools: ${toolNames.join(", ")}`);
  }
  if (dataFileSummaries.length > 0) {
    parts.push(`Data files:\n${dataFileSummaries.map((s) => `- ${s}`).join("\n")}`);
  }

  const prompt =
    parts.join("\n\n") +
    "\n\nWrite one sentence describing what this workspace is used for.";

  return generateSummary(prompt, databaseId);
}
