import { getSession, saveSession } from "@backend/core/session/sessions/session_all";
import { getLLMConfigByDatabaseId } from "@backend/core/user/getLLMApiKey";
import { callLLM } from "@backend/core/models/llm-client";
import { markdownToHtml } from "@backend/utilities/markdownToHtml";

export async function generatePostMortem(
  databaseId: string,
  auditId: string,
  sessionId: string,
): Promise<string> {
  const session = await getSession(databaseId, sessionId);
  if (!session) throw new Error("Session not found");

  const auditMsg = session.messages.find(
    (m: any) =>
      m?.json?.workflowAudit?.auditId === auditId ||
      m?.json?.successFactorAudit?.auditId === auditId,
  );
  if (!auditMsg) throw new Error("Audit verdict not found (auditId=" + auditId + ")");

  // Build session summary for the LLM
  const workflowId = session.activeWorkflowId || session.metadata?.workflow_id;
  const execution = workflowId ? session.workflows?.[workflowId] : undefined;
  const nodes = execution?.nodes || [];
  const verdictJson = (auditMsg.json?.workflowAudit ?? auditMsg.json?.successFactorAudit ?? {}) as Record<string, unknown>;
  const sessionSummary = [
    `Workflow: ${String(verdictJson.subject || "Unknown")}`,
    `Tool steps: ${nodes.filter((n: any) => n.tool_id).length}`,
    `Messages: ${session.messages.length}`,
    `Audit verdict: ${String(verdictJson.statusLabel ?? verdictJson.statusReason ?? verdictJson.verdict ?? "unknown")}`,
    ``,
    `### Session messages`,
    session.messages.map((m: any, i: number) =>
      `[${i + 1}] **${m.role}**${m.nodeLabel ? ` (${m.nodeLabel})` : ""}: ${(m.markdown || "").substring(0, 500)}`
    ).join("\n"),
  ].join("\n");

  const systemPrompt = `You are a post-mortem analysis assistant. Given a workflow session trace and the knowledge packs used to build the workflow, produce a 360-degree analysis in markdown.

Cover:
1. **Workflow overview** — what was attempted
2. **Step-by-step execution** — what happened at each step
3. **Knowledge alignment** — how the tool outputs align with the knowledge packs used
4. **Audit verdict** — was the outcome correct? Why or why not?
5. **Recommendations** — improvements for next time

Be specific and reference actual data from the session trace.`;

  // Call LLM
  const llmConfig = await getLLMConfigByDatabaseId(databaseId);
  const result = await callLLM(llmConfig, {
    systemPrompt,
    messages: [
      { role: "user", content: sessionSummary },
    ],
    temperature: 0.3,
    maxTokens: 4096,
  });

  const markdown = result.text || "Analysis generation returned empty result.";
  const html = markdownToHtml(markdown, "info");

  // Store result as a session message
  session.messages.push({
    id: `post-mortem-${auditId}-${Date.now()}`,
    role: "info",
    source: "post-mortem",
    nodeLabel: "360° Analysis",
    html: `<div class="prose prose-sm max-w-none">${html}</div>`,
    markdown: markdown,
    timestamp: new Date(),
    json: {
      postMortem: true,
      auditId,
      generatedAt: new Date().toISOString(),
      model: result.model,
    },
  } as any);

  await saveSession(databaseId, session);

  return markdown;
}
