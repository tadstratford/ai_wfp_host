import { v4 as uuidv4 } from "uuid";
import { Session, Message } from "../../../shared/types";
import { saveSession } from "../sessions/session_all";
import { markdownToHtml } from "../../../shared/utils/markdownToHtml";
import { createLinkMessageWithLLM } from "./createLinkMessageWithLLM";

/**
 * Generate descriptive markdown for the left panel message link
 */
const generateMessageLinkMarkdown = async (
  message: Partial<Message>,
  session: Session
): Promise<string> => {
  const role = message.role;
  const toolName = message.toolName;
  const source = message.source;

  // Extract plain text from HTML for analysis
  const content = message.html?.replace(/<[^>]*>/g, "") || "";
  const contentPreview =
    content.length > 40 ? content.substring(0, 40) + "..." : content;

  switch (role) {
    case "user":
      // Use LLM to create intelligent summaries for user messages
      try {
        const userMarkdown = message.markdown || content;
        if (userMarkdown && userMarkdown.trim()) {
          return await createLinkMessageWithLLM(userMarkdown, session);
        } else {
          return "No content";
        }
      } catch (error) {
        console.error(
          "[Message Link] LLM summarization failed for user message:",
          error
        );
        // Fallback to simple logic
        if (message.imageData || content.includes("[FILE:")) {
          const fileMatch = content.match(/\[FILE:\s*([^\]]+)\]/i);
          const fileName = fileMatch ? fileMatch[1] : "image";
          return `Uploaded ${fileName}`;
        } else {
          return contentPreview || "User message";
        }
      }

    case "assistant":
      // Analyze assistant response content
      if (
        content.includes("total") ||
        content.includes("$") ||
        content.includes("expense")
      ) {
        const totalMatch = content.match(/\$[\d,]+\.?\d*/);
        const total = totalMatch ? totalMatch[0] : "";
        return `**Provided analysis** ${total ? `with total ${total}` : "of financial data"
          }`;
      } else if (content.includes("task") || content.includes("TODO")) {
        return `**Updated tasks** and workflow progress`;
      } else if (content.includes("spreadsheet") || content.includes("data")) {
        return `**Processed data** and generated insights`;
      } else if (
        content.includes("Please provide") ||
        content.includes("need more information")
      ) {
        return `**Requested additional information** to proceed`;
      } else if (
        content.includes("Completed all") &&
        content.includes("action")
      ) {
        const actionMatch = content.match(/(\d+)\s+action/);
        const count = actionMatch ? actionMatch[1] : "";
        return `**Completed execution** of ${count || "all"} actions`;
      } else if (
        content.includes("Q1") ||
        content.includes("Q2") ||
        content.includes("Q3") ||
        content.includes("Q4")
      ) {
        return `**Analyzed quarterly performance** data by department`;
      } else if (content.trim().length < 10) {
        return ""; // Filter out very short responses
      } else {
        return `**Responded:** ${contentPreview}`;
      }

    case "tool":
      // Describe tool actions and results
      if (toolName === "get_current_weather") {
        return `**Weather data** retrieved for location`;
      } else if (toolName === "create_todo" || toolName === "complete_todo") {
        const action = toolName.includes("create") ? "Created" : "Completed";
        return `**${action} todo item** in task management`;
      } else if (toolName && toolName.includes("spreadsheet")) {
        return `**Processed spreadsheet** data extraction`;
      } else if (toolName) {
        return `**Executed ${toolName}** tool operation`;
      } else {
        return `**Tool result:** ${contentPreview}`;
      }

    case "system":
      // Generate meaningful descriptions for system messages instead of filtering
      if (source === "update_tasks_response") {
        return "**Task list updated** with new priorities";
      } else if (source === "update_actions_response") {
        return "**Actions selected** for execution";
      } else if (source === "generate_summary_response") {
        return "**Summary generated** for conversation";
      } else if (source === "update_parameters_response") {
        return "**Parameters extracted** from conversation";
      } else if (source === "business_rules") {
        return "**Business rules** applied to process";
      } else if (source && source.includes("_response")) {
        const processName = source.replace("_response", "").replace(/_/g, " ");
        return `**${processName}** process completed`;
      } else if (source && source.includes("prompt_")) {
        return "**System prompt** for process guidance";
      } else if (source === "memory_manager") {
        return "**Memory system** analysis";
      } else if (source === "execution_analysis") {
        return "**Execution analysis** completed";
      } else if (
        content.includes("Business Rules") ||
        content.includes("You are a memory management") ||
        content.includes("You are an execution analysis")
      ) {
        return "**System guidance** for process flow";
      } else if (
        content.includes("confirmation") &&
        content.includes("pending")
      ) {
        return `**Memory confirmation** pending user approval`;
      } else if (content.includes("[PROCESSING]")) {
        const match = content.match(/\[PROCESSING\]\s*(.+?)(?:\n|$)/);
        const operation = match ? match[1] : "operation";
        return `**Processing** ${operation}`;
      } else if (content.includes("[SUCCESS]")) {
        const match = content.match(/\[SUCCESS\]\s*(.+?)(?:\n|$)/);
        const result = match ? match[1] : "completed";
        return `**Success:** ${result}`;
      } else if (content.includes("[ERROR]")) {
        const match = content.match(/\[ERROR\]\s*(.+?)(?:\n|$)/);
        const error = match ? match[1] : "error occurred";
        return `**Error:** ${error}`;
      } else if (source === "vision_analysis") {
        return `**Analyzed image** for content extraction`;
      } else if (content.includes("Selected") && content.includes("action")) {
        const toolMatch = content.match(/action for Task \d+: ([^\\n]+)/);
        const tool = toolMatch ? toolMatch[1] : "tool";
        return `**Selected ${tool}** for task execution`;
      } else {
        // Fallback for other system messages
        if (source) {
          const sourceName = source.replace(/_/g, " ");
          return `**System:** ${sourceName}`;
        } else {
          return `**System:** ${contentPreview}`;
        }
      }

    case "tasks":
      // Handle task lists with counts
      if (message.markdown || content) {
        const taskSource = message.markdown || content;
        const totalTasks = (taskSource.match(/- \[[ x]\]/g) || []).length;
        const completedTasks = (taskSource.match(/- \[x\]/g) || []).length;
        const pendingTasks = totalTasks - completedTasks;

        if (totalTasks === 0) {
          return `**Task list** empty`;
        } else if (completedTasks === totalTasks) {
          return `**All tasks completed** (${totalTasks} total)`;
        } else {
          return `**Task progress** ${completedTasks}/${totalTasks} completed, ${pendingTasks} pending`;
        }
      }
      return `**Task list** updated`;

    case "spreadsheet":
      // Handle spreadsheet messages
      try {
        const json = message.json || {};
        if (json.type === "metadata") {
          const metadata = json.metadata || {};
          return `**Spreadsheet detected** ${(metadata as any).estimatedRowCount || 0}×${(metadata as any).estimatedColumnCount || 0} ${(metadata as any).dataFormat || 'unknown'}`;
        } else if (json.type === "converted") {
          return `**Data extracted** ${json.rowCount}×${json.columnCount} rows from spreadsheet`;
        } else {
          return `**Spreadsheet processed** #${json.sequenceNumber || "?"}`;
        }
      } catch (error) {
        return `**Spreadsheet data** processed`;
      }

    default:
      return `**${role || "Message"}:** ${contentPreview}`;
  }
};

/**
 * Unified addMessage function - accepts object parameters only
 *
 * @example
 * // Plain text usage (legacy - prefer html or markdown)
 * addMessage({
 *   session,
 *   content: "Hello world"
 * });
 *
 * // Markdown usage (recommended)
 * addMessage({
 *   session,
 *   markdown: "# Processing complete\n\n**Status:** Success",
 *   role: "assistant"
 * });
 *
 * // HTML usage
 * addMessage({
 *   session,
 *   html: "<h1>Processing complete</h1><p><strong>Status:</strong> Success</p>",
 *   role: "assistant"
 * });
 */
export const addMessage = async (
  messageData: Partial<Message> & { session: Session, databaseId?: string }
): Promise<Session> => {
  const { session, databaseId, ...msgData } = messageData;

  // Auto-generate required fields
  const id = msgData.id || uuidv4();
  const timestamp = msgData.timestamp || new Date();
  const role = msgData.role || "assistant";
  const source = msgData.source || msgData.toolName || "system";

  // Handle markdown -> HTML conversion
  let html = msgData.html || "";
  let markdown = msgData.markdown || "";

  if (markdown && markdown.length > 0) {
    html = markdownToHtml(markdown, role);
  }

  if (!html || html.length === 0) {
    html = "not able to make or show HTML.";
  }

  const message: Message = {
    id,
    role,
    source,
    html,
    markdown,
    timestamp,
    messageLinkMarkdown: undefined, // Will be auto-generated below
    messageLinkHTML: undefined, // Will be auto-generated below
    data: msgData.data,
    json: msgData.json,
    llm_usage: msgData.llm_usage,
    knowledgeUsed: msgData.knowledgeUsed,
    toolId: msgData.toolId,
    toolName: msgData.toolName,
    applicationId: msgData.applicationId,
    confirmationId: msgData.confirmationId,
    imageData: msgData.imageData,
    imageMetadata: msgData.imageMetadata,
  };

  // Auto-generate messageLinkMarkdown and convert to HTML for left panel display
  message.messageLinkMarkdown = await generateMessageLinkMarkdown(
    message,
    session
  );
  message.messageLinkHTML = message.messageLinkMarkdown
    ? markdownToHtml(message.messageLinkMarkdown)
    : "";

  session.messages = [...(session.messages || []), message];

  if (databaseId) {
    await saveSession(databaseId, session);
  }

  // Notify SSE clients — centralized here so callers don't need to call notifyClients manually
  try {
    const { notifyClients } = await import("@backend/interfaces/streaming/simpleSSE");
    notifyClients(session.session_id, "new_message");
  } catch {}

  return session;
};

/**
 * Helper functions for common message patterns
 */
export const addSystemMessage = async (
  databaseId: string,
  session: Session,
  markdown: string,
  source?: string
): Promise<Session> => {
  return addMessage({
    databaseId,
    session,
    markdown,
    role: "system",
    source: source || "system",
  });
};

export const addErrorMessage = async (
  databaseId: string,
  session: Session,
  markdown: string,
  source?: string
): Promise<Session> => {
  return addMessage({
    databaseId,
    session,
    markdown,
    role: "error",
    source: source || "system",
  });
};

export const addInfoMessage = async (
  databaseId: string,
  session: Session,
  markdown: string,
  source?: string
): Promise<Session> => {
  return addMessage({
    databaseId,
    session,
    markdown,
    role: "info",
    source: source || "system",
  });
};

export const addAssistantMessage = async (
  databaseId: string,
  session: Session,
  markdown: string,
  source?: string
): Promise<Session> => {
  return addMessage({
    databaseId,
    session,
    markdown,
    role: "assistant",
    source: source || "assistant",
  });
};

/**
 * Get all messages for a specific session
 */
export const getMessagesBySessionId = async (databaseId: string, sessionId: string) => {
  const { getSession } = await import("../sessions/session_all");
  const session = await getSession(databaseId, sessionId);
  return session?.messages || [];
};
