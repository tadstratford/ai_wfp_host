import { Workflow, WorkflowNode, Session } from "@backend/types";
import { getToolDefinition, getToolFunction, isMcpTool, getMcpServerName, getToolRegistry } from "@core/tools/registry";
import { saveSession } from "@backend/core/session/sessions/session_all";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { requireSessionByDatabaseId, getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { mergeParameters, recordToParameters, getParameterValue, setParameterValue, resolveTemplates } from "@backend/core/settings/parameterHelpers";
import { getLinearOrder } from "./graphWorkflow";
import { getRunDepth, setRunDepth, getRunSessionId, setRunSessionId } from "./runContext";
import { addMessage } from "@backend/core/session/messages";
import type { TypedEnvelope, MetaData } from "@backend/core/wfp/types";
import { logError } from "@backend/core/logging/errorLogger";

/** Read raw data content from the active WorkspaceSession (no SQLite). */
function readUserDataContent(databaseId: string, name: string): string | null {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return null;
  const entry = session.getDataEntry(name);
  if (!entry) return null;
  return typeof entry.content === "string" ? entry.content : null;
}

// ---------------------------------------------------------------------------
// Guardrails — protect the server from runaway workflows
// ---------------------------------------------------------------------------

const LIMITS = {
  /** Max nodes the executor will process in one run */
  MAX_NODES: 50,
  /** Max total workflow execution time (ms) — 30 minutes */
  MAX_WORKFLOW_DURATION_MS: 30 * 60 * 1000,
  /** Max messages per session before the executor refuses to continue */
  MAX_SESSION_MESSAGES: 500,
  /** Per-tool timeout (ms) — 5 minutes */
  TOOL_TIMEOUT_MS: 5 * 60 * 1000,
};

/** Escape HTML special characters to prevent XSS in generated HTML strings */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Typed envelope helpers
// ---------------------------------------------------------------------------

/** Check if a value is a TypedEnvelope */
function isEnvelope(value: any): value is TypedEnvelope {
  return value && typeof value === 'object' && value._meta && typeof value._meta === 'object' && 'data' in value;
}

/** Wrap a raw value in a TypedEnvelope, auto-detecting type */
function wrapInEnvelope(value: any, source?: string): TypedEnvelope {
  if (isEnvelope(value)) return value; // already wrapped

  if (typeof value === 'string') {
    return { _meta: { type: 'string', source, length: value.length }, data: value };
  }
  if (typeof value === 'number') {
    return { _meta: { type: 'number', source }, data: value };
  }
  if (typeof value === 'boolean') {
    return { _meta: { type: 'boolean', source }, data: value };
  }
  if (Array.isArray(value)) {
    const columns = value.length > 0 && typeof value[0] === 'object' ? Object.keys(value[0]) : undefined;
    return { _meta: { type: 'json_array', source, rowCount: value.length, columns }, data: value };
  }
  if (typeof value === 'object' && value !== null) {
    return { _meta: { type: 'json_object', source }, data: value };
  }
  return { _meta: { type: 'text', source }, data: value };
}

/**
 * Resolve `{{name}}` references inside a node's raw tool_parameters, recursively
 * through objects/arrays. Object/array session values are JSON-stringified so
 * they survive the run_MCP bridge (whose `args` is a JSON string) — this is how
 * `save_data(value="{{result}}")` receives the prior step's data as a string.
 * Unresolved references are left as-is (prepareNodeParams hard-fails later).
 *
 * Thin wrapper over the shared `resolveTemplates` resolver (used identically by
 * the chat build loop) so both paths resolve `{{name}}` against the same store.
 */
function resolveParamTemplates(value: unknown, session: Session): unknown {
  return resolveTemplates(value, session.parameters);
}

/**
 * Format a human-readable summary line for a loaded data source
 */
function formatDataSummary(name: string, meta: MetaData): string {
  switch (meta.type) {
    case "csv":
      return `Loaded "${name}" — CSV, ${meta.rowCount} rows, columns: ${meta.columns?.join(", ")}`;
    case "json_array":
      return `Loaded "${name}" — JSON array, ${meta.rowCount} items${meta.columns ? `, keys: ${meta.columns.join(", ")}` : ""}`;
    case "json_object":
      return `Loaded "${name}" — JSON object`;
    case "json_cells":
      return `Loaded "${name}" — raw sheet (cell-address map, ${meta.rowCount ?? "?"} rows)`;
    case "text":
      return `Loaded "${name}" — text, ${meta.length} characters`;
    default:
      return `Loaded "${name}"`;
  }
}

/**
 * Run a tool by ID with error boundaries and timeout protection
 */
export const runTool = async (
  session: Session,
  toolId: string,
  databaseId: string
): Promise<Session> => {
  try {
    console.log(`[runTool] Running tool: ${toolId}`);

    const toolDef = await getToolDefinition(toolId, databaseId);
    if (!toolDef) {
      throw new Error(`This step's configuration is missing. The tool "${toolId}" could not be found — it may have been deleted or renamed.`);
    }

    const toolFunction = await getToolFunction(toolId, databaseId);
    if (!toolFunction) {
      throw new Error(`This step's code could not be loaded. The tool "${toolId}" exists but has no executable function — try rebuilding the workflow.`);
    }

    const { createWFP_API } = await import('@backend/core/wfp');
    const api = createWFP_API(session, databaseId, toolId);

    const toolResult = await Promise.race([
      (toolFunction as any)(api),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("This step took too long to finish (5 minute limit). Try simplifying the step or splitting it into smaller parts.")), LIMITS.TOOL_TIMEOUT_MS)
      ),
    ]);

    const resultObj = toolResult as any;
    if (resultObj?.status === 'error' || resultObj?.success === false) {
      throw new Error(resultObj?.error || resultObj?.statusMessage || resultObj?.content || 'This step ran but did not complete successfully. Check that the step has valid inputs and try running again.');
    }

    if (session.waitingForInput || resultObj?.status === 'paused') {
      console.log(`[runTool] Tool ${toolId} requested a workflow pause for input.`);
      session.waitingForInput = true;
    }

    return session;
  } catch (error: any) {
    // PauseSignal isn't a failure — it's the tool's way of asking the
    // executor to halt for user input. api.pauseForInput already set
    // session.waitingForInput and added the form message; just return
    // and let the outer loop notice the pause.
    const { isPauseSignal } = await import("@backend/core/wfp/PauseSignal");
    if (isPauseSignal(error)) {
      console.log(`[runTool] Tool ${toolId} paused for input (pauseId=${error.pauseId}).`);
      session.waitingForInput = true;
      return session;
    }

    console.error(`[runTool] Error in ${toolId}:`, error);
    logError("executor", error, { context: { toolId, sessionId: session.session_id } });

    const nodeLabel = session.metadata?.currentNode?.label || toolId;
    const safeLabel = escapeHtml(nodeLabel);
    const safeMessage = escapeHtml(error.message || "Something went wrong while running this step.");

    session.messages.push({
      id: Date.now().toString(),
      role: "error",
      source: toolId,
      nodeId: session.metadata?.currentNode?.node_id,
      nodeLabel: session.metadata?.currentNode?.label,
      html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
        <div class="text-red-800 dark:text-red-400 font-semibold">Step Failed: ${safeLabel}</div>
        <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">${safeMessage}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-3">The workflow stopped here. Use <strong>/analyze</strong> for a detailed breakdown, or <strong>/modify</strong> to fix the issue.</div>
      </div>`,
      markdown: `**Step Failed: ${nodeLabel}**\n\n${error.message}\n\n_Use /analyze for details or /modify to fix._`,
      timestamp: new Date(),
      json: { error: error.message, toolId },
    });

    return session;
  }
};

// ---------------------------------------------------------------------------
// Prepare a node for execution: resolve parameters and wrap in envelopes
// ---------------------------------------------------------------------------

/**
 * Load a user data entry from the active WorkspaceSession and return as a
 * TypedEnvelope. Uses pre-computed metadata fields when available.
 */
function loadUserDataEnvelope(databaseId: string, name: string): TypedEnvelope | undefined {
  const session = getSessionByDatabaseId(databaseId);
  if (!session) return undefined;
  const entry = session.getDataEntry(name);
  if (!entry) return undefined;

  const content = typeof entry.content === "string" ? entry.content : "";

  // Use pre-computed structured form if available
  if (entry.content_type && entry.content_type !== "text" && entry.content_json !== undefined) {
    return {
      _meta: {
        type: entry.content_type as MetaData["type"],
        source: `user_data:${name}`,
        rowCount: entry.row_count ?? undefined,
        columns: entry.columns,
      },
      data: entry.content_json,
    };
  }

  // Fall back to auto-detection from the raw content
  return parseRawContent(content, name);
}

/**
 * Parse raw content string into a TypedEnvelope (auto-detect format)
 */
function parseRawContent(rawContent: string, sourceName: string): TypedEnvelope {
  if (!rawContent || typeof rawContent !== 'string') {
    return { _meta: { type: 'text', source: `user_data:${sourceName}`, length: 0 }, data: '' };
  }

  const trimmed = rawContent.trim();

  // Try JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const columns = parsed.length > 0 && typeof parsed[0] === 'object' ? Object.keys(parsed[0]) : undefined;
        return {
          _meta: { type: 'json_array', source: `user_data:${sourceName}`, rowCount: parsed.length, columns },
          data: parsed,
        };
      }
      return {
        _meta: { type: 'json_object', source: `user_data:${sourceName}` },
        data: parsed,
      };
    } catch { /* not valid JSON */ }
  }

  // Try CSV
  const lines = trimmed.split('\n');
  if (lines.length >= 2 && lines[0].includes(',')) {
    const rows = parseCsv(trimmed);
    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      return {
        _meta: { type: 'csv', source: `user_data:${sourceName}`, rowCount: rows.length, columns },
        data: rows,
      };
    }
  }

  // Plain text
  return {
    _meta: { type: 'text', source: `user_data:${sourceName}`, length: rawContent.length },
    data: rawContent,
  };
}

/** Parse a single CSV line respecting quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

/** Parse CSV text into an array of objects */
function parseCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

/**
 * Prepare node parameters: merge defaults + config + toolParameters,
 * resolve {{variable}} templates (with user_data fallback), wrap in envelopes.
 */
async function prepareNodeParams(
  currentNode: WorkflowNode,
  session: Session,
  databaseId: string
): Promise<void> {
  // Fetch tool definition to apply defaults
  let toolDef: any = null;
  try {
    toolDef = await getToolDefinition(currentNode.tool_id!, databaseId);
  } catch (e) {
    console.warn(`[executor] Failed to fetch tool definition for ${currentNode.tool_id}:`, e);
  }

  const defaultParams: any[] = [];
  if (toolDef && toolDef.inputs) {
    toolDef.inputs.forEach((input: any) => {
      const defaultValue = input.value !== undefined ? input.value : input.default;
      if (defaultValue !== undefined) {
        defaultParams.push({ name: input.name, type: input.type || 'string', value: defaultValue });
      }
    });
  }

  const nodeParams = [
    ...defaultParams,
    ...recordToParameters(currentNode.tool_config),
    ...recordToParameters(currentNode.tool_parameters)
  ];

  const uniqueNodeParams = nodeParams.reduce((acc: any[], param) => {
    const idx = acc.findIndex(p => p.name === param.name);
    if (idx >= 0) { acc[idx] = param; } else { acc.push(param); }
    return acc;
  }, []);

  // Resolve {{variable}} references — unified syntax (no more {{[name]}})
  // Falls back to the workspace's `data` map when variable not found in session params
  const missingData: string[] = [];
  const loadedDataSummaries: string[] = [];

  const resolvedParams = uniqueNodeParams.map((param: any) => {
    if (typeof param.value !== 'string') {
      // Non-string values: wrap in envelope if not already wrapped
      return { ...param, value: wrapInEnvelope(param.value, `node:${currentNode.tool_id}`) };
    }

    // Exact match: {{variable_name}} → resolve to full envelope
    const exactMatch = param.value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
    if (exactMatch) {
      const key = exactMatch[1].trim();

      // Check session parameters first (already enveloped)
      const sessionParam = session.parameters?.find((p: any) => p.name === key);
      if (sessionParam?.value !== undefined) {
        // If already an envelope, use as-is; otherwise wrap
        const val = isEnvelope(sessionParam.value) ? sessionParam.value : wrapInEnvelope(sessionParam.value, `param:${key}`);
        return { ...param, value: val, type: 'object' };
      }

      // Fall back to the workspace's `data` map
      const userDataEnvelope = loadUserDataEnvelope(databaseId, key);
      if (userDataEnvelope) {
        loadedDataSummaries.push(formatDataSummary(key, userDataEnvelope._meta));
        return { ...param, value: userDataEnvelope, type: 'object' };
      }

      // Not found anywhere — hard fail (no-fallbacks): a dangling {{variable}} is a bug.
      throw new Error(
        `Unresolved variable "{{${key}}}" on node "${currentNode.label}" — no matching session parameter or workspace data.`,
      );
    }

    // Partial match: "Hello {{name}}" → string interpolation
    if (param.value.includes('{{') && param.value.includes('}}')) {
      let unresolvedKey: string | null = null;
      const resolved = param.value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match: string, path: string) => {
        const key = path.trim();

        // Check session params
        const sessionParam = session.parameters?.find((p: any) => p.name === key);
        if (sessionParam?.value !== undefined) {
          const raw = isEnvelope(sessionParam.value) ? sessionParam.value.data : sessionParam.value;
          return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
        }

        // Fall back to the active workspace's `data` map (raw content for string interpolation)
        const content = readUserDataContent(databaseId, key);
        if (content !== null) return content;

        unresolvedKey = key;
        return match; // leave unresolved
      });

      // Hard fail (no-fallbacks): a dangling {{variable}} is a bug.
      if (unresolvedKey !== null) {
        throw new Error(
          `Unresolved variable "{{${unresolvedKey}}}" on node "${currentNode.label}" — no matching session parameter or workspace data.`,
        );
      }

      return { ...param, value: wrapInEnvelope(resolved, `template`), type: 'object' };
    }

    // Plain string value — wrap in envelope
    return { ...param, value: wrapInEnvelope(param.value, `node:${currentNode.tool_id}`), type: 'object' };
  });

  // Emit a chat message showing what data was loaded from user_data
  if (loadedDataSummaries.length > 0) {
    session.messages.push({
      id: `data-load-${Date.now()}`,
      role: "assistant" as const,
      source: "data-loader",
      nodeId: currentNode.id,
      nodeLabel: currentNode.label,
      html: `<div class="text-sm text-gray-600 dark:text-gray-400 py-2 space-y-1">${loadedDataSummaries.map(s => `<div>${escapeHtml(s)}</div>`).join("")}</div>`,
      markdown: loadedDataSummaries.join("\n"),
      timestamp: new Date(),
      json: { type: "data_loaded", count: loadedDataSummaries.length },
    } as any);
  }

  session.parameters = mergeParameters(session.parameters, resolvedParams);
}

// ---------------------------------------------------------------------------
// Execute a single node and return whether it succeeded
// ---------------------------------------------------------------------------

async function executeNode(
  databaseId: string,
  node: WorkflowNode,
  session: Session,
  workflowId: string
): Promise<{ hasError: boolean }> {
  if (!node.tool_id) return { hasError: false };

  // Guard: message count limit
  if (session.messages.length >= LIMITS.MAX_SESSION_MESSAGES) {
    const safeLabel = escapeHtml(node.label || "Unknown");
    session.messages.push({
      id: Date.now().toString(),
      role: "error",
      source: node.tool_id,
      nodeId: node.id,
      nodeLabel: node.label,
      html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
        <div class="text-red-800 dark:text-red-400 font-semibold">Session Limit Reached</div>
        <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">This session has ${session.messages.length} messages (limit: ${LIMITS.MAX_SESSION_MESSAGES}). Start a new session to continue running workflows.</div>
      </div>`,
      markdown: `**Session limit reached** at step "${node.label}". ${session.messages.length} messages (limit: ${LIMITS.MAX_SESSION_MESSAGES}). Start a new session to continue.`,
      timestamp: new Date(),
      json: { error: "session_message_limit", toolId: node.tool_id },
    });
    return { hasError: true };
  }

  console.log(`[executor] Step ${node.step_order ?? '?'}: ${node.label} (${node.tool_id})`);

  // Route MCP tools through run_MCP — collect original tool_parameters as args.
  // Native tools take precedence: when a native tool shares a name with an MCP
  // tool (e.g. "chat_download"), run it natively instead of through the bridge
  // (the MCP session tools need a chat AppHook that doesn't exist at run time).
  const nativeRegistry = await getToolRegistry();
  if (isMcpTool(node.tool_id) && !nativeRegistry.has(node.tool_id)) {
    const serverName = getMcpServerName(node.tool_id);
    if (serverName) {
      const originalParams = resolveParamTemplates(
        node.tool_parameters ?? {},
        session,
      ) as Record<string, unknown>;
      node = {
        ...node,
        tool_id: "run_MCP",
        tool_parameters: {
          serverName,
          toolName: node.tool_id,
          args: JSON.stringify(originalParams),
        },
      };
    }
  }

  session.metadata = session.metadata || {};
  session.metadata.currentNode = {
    id: node.id,
    label: node.label,
    tool_id: node.tool_id
  };

  try {
    await prepareNodeParams(node, session, databaseId);
  } catch (error: any) {
    console.error(`[executor] Parameter prep failed for "${node.label}":`, error);
    const safeLabel = escapeHtml(node.label || "Unknown");
    const safeMessage = escapeHtml(error.message || "Unknown error");
    session.messages.push({
      id: Date.now().toString(),
      role: "error",
      source: node.tool_id,
      nodeId: node.id,
      nodeLabel: node.label,
      html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
        <div class="text-red-800 dark:text-red-400 font-semibold">Missing Data for "${safeLabel}"</div>
        <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">${safeMessage}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-3">This step needs data that wasn't available. Make sure your data is loaded via <strong>/data</strong> or the User Data page before running.</div>
      </div>`,
      markdown: `**Missing Data for "${node.label}"**\n\n${error.message}\n\n_Load data via /data or the User Data page before running._`,
      timestamp: new Date(),
      json: { error: error.message, toolId: node.tool_id },
    });
    return { hasError: true };
  }

  // Show a progress indicator in the chat while the tool runs
  const safeLabel = escapeHtml(node.label || "Unknown");
  const progressMsg: any = {
    id: `progress-${node.id}`,
    role: "assistant",
    source: `node-progress:${node.id}`,
    nodeId: node.id,
    nodeLabel: node.label,
    html: `<div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
      <div class="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500"></div>
      <span>Running: <strong>${safeLabel}</strong></span>
    </div>`,
    markdown: `Running: **${node.label}**`,
    timestamp: new Date(),
    json: { type: "progress", tool_id: node.tool_id },
  };
  session.messages.push(progressMsg);
  await saveSession(databaseId, session);
  notifyClients(session.session_id, "new_message");

  // Remove the progress message before running the tool (tool will add its own output)
  session.messages = session.messages.filter((m: any) => m.id !== progressMsg.id);

  const messageCountBefore = session.messages.length;
  session = await runTool(session, node.tool_id, databaseId);

  const newMessages = session.messages.slice(messageCountBefore);
  const hasError = newMessages.some(m => m.role === 'error' || m.json?.error);

  // Save after each tool so SSE can pick up messages
  await saveSession(databaseId, session);
  notifyClients(session.session_id, "new_message");

  return { hasError };
}

// ---------------------------------------------------------------------------
// Main entry point: execute workflow as a linear sequence by step_order
// ---------------------------------------------------------------------------

export const executeWorkflowActions = async (
  databaseId: string,
  workflow: Workflow,
  session: Session
): Promise<Session> => {
  const execution = session.workflows?.[workflow.id];
  const nodes = execution?.nodes || workflow.nodes;
  const workflowId = workflow.id;

  session.metadata = session.metadata || {};
  session.metadata.workflow_id = workflowId;
  session.activeWorkflowId = workflowId;
  session.instance_status = 'in_progress';

  // Publish this run's depth + session so a nested `run_workflow` can inherit
  // the depth and report back to the right parent session.
  const prevRunDepth = getRunDepth();
  const prevRunSessionId = getRunSessionId();
  setRunDepth((session.metadata as any)?.run_depth ?? 0);
  setRunSessionId(session.session_id);

  await saveSession(databaseId, session);

  notifyClients(session.session_id, "busy_start", `Running ${workflow.name ?? "workflow"}…`);
  try {
    // Sort nodes into linear execution order
    const orderedNodes = getLinearOrder(nodes);

    // Guard: node count limit
    if (orderedNodes.length > LIMITS.MAX_NODES) {
      const safeName = escapeHtml(workflow.name || "Unknown");
      session.messages.push({
        id: Date.now().toString(),
        role: "error",
        source: "workflow_executor",
        html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
          <div class="text-red-800 dark:text-red-400 font-semibold">Workflow Too Large</div>
          <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">"${safeName}" has ${orderedNodes.length} steps, but the limit is ${LIMITS.MAX_NODES}. Try splitting it into smaller workflows.</div>
        </div>`,
        markdown: `**Workflow too large:** "${workflow.name}" has ${orderedNodes.length} nodes (limit: ${LIMITS.MAX_NODES}).`,
        timestamp: new Date(),
        json: { error: "node_count_limit", count: orderedNodes.length, limit: LIMITS.MAX_NODES },
      });
      session.instance_status = 'awaiting_feedback';
      return session;
    }

    // Track total execution time
    const workflowStartTime = Date.now();

    for (const node of orderedNodes) {
      if (!node.tool_id) continue;

      // Guard: total workflow duration
      const elapsed = Date.now() - workflowStartTime;
      if (elapsed > LIMITS.MAX_WORKFLOW_DURATION_MS) {
        const minutes = Math.round(elapsed / 60000);
        const safeLabel = escapeHtml(node.label || "Unknown");
        session.messages.push({
          id: Date.now().toString(),
          role: "error",
          source: "workflow_executor",
          nodeId: node.id,
          nodeLabel: node.label,
          html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
            <div class="text-red-800 dark:text-red-400 font-semibold">Workflow Timed Out</div>
            <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">Stopped at step "${safeLabel}" after ${minutes} minutes (limit: ${LIMITS.MAX_WORKFLOW_DURATION_MS / 60000} min). The earlier steps may have taken too long, or this workflow has too many steps. Try splitting into smaller workflows.</div>
          </div>`,
          markdown: `**Workflow timed out** at step "${node.label}" after ${minutes} min. Try splitting into smaller workflows.`,
          timestamp: new Date(),
          json: { error: "workflow_timeout", elapsed_ms: elapsed },
        });
        break;
      }

      const { hasError } = await executeNode(databaseId, node, session, workflowId);

      if (hasError) {
        console.log(`[executor] Step "${node.label}" failed — stopping workflow`);
        break;
      }

      if (session.waitingForInput) {
        console.log(`[executor] Paused at step "${node.label}" — waiting for user input`);
        session.metadata = session.metadata || {};
        session.metadata.pausedAtNode = node.id;
        session.metadata.pausedAtStepOrder = node.step_order;
        if (session.workflows && session.workflows[workflowId]) {
          session.workflows[workflowId].pauseReason = "input";
          session.workflows[workflowId].pausedAt = node.id;
        }
        break;
      }

      // Mark end node
      if (node.type === "end" || node.tool_id === "workflow_end") {
        if (session.workflows && session.workflows[workflowId]) {
          session.workflows[workflowId].completedAt = new Date();
        }
        session.instance_status = 'awaiting_feedback';
        break;
      }
    }

    // If we exited the loop without hitting an end node (error or last node),
    // still mark as awaiting_feedback so the UI shows completion buttons
    if (session.instance_status === 'in_progress') {
      session.instance_status = 'awaiting_feedback';
    }

    // Runs are shown in Run History — no need to duplicate in changelog

    return session;
  } finally {
    setRunDepth(prevRunDepth);
    setRunSessionId(prevRunSessionId);
    notifyClients(session.session_id, "busy_end");
  }
};

// ---------------------------------------------------------------------------
// Transient plan execution (chat-composed plans)
// ---------------------------------------------------------------------------

/** Structural shape of a chat-composed run plan. Kept local (not importing the
 *  chat layer) so the runner stays decoupled; `src/chat/plan/types.ts`'s
 *  `NodePlan` satisfies this shape. */
export interface PlanStepLike {
  tool_id: string;
  tool_parameters: Record<string, unknown>;
  label?: string;
}

export interface PlanLike {
  steps: PlanStepLike[];
}

/**
 * Run an unpersisted, chat-composed plan in the current session.
 *
 * Unlike `executeWorkflowActions` (which snapshots a persisted workflow into
 * `session.workflows[workflowId]`), this walks the plan's steps directly through
 * `executeNode` so node progress streams into the chat session inline — the
 * "run as part of the chat" path.
 */
export const executePlanInSession = async (
  databaseId: string,
  session: Session,
  plan: PlanLike,
): Promise<Session> => {
  const steps = plan?.steps ?? [];

  if (steps.length > LIMITS.MAX_NODES) {
    session.messages.push({
      id: Date.now().toString(),
      role: "error",
      source: "plan_executor",
      html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4"><div class="text-red-800 dark:text-red-400 font-semibold">Plan Too Large</div><div class="text-sm text-gray-700 dark:text-gray-300 mt-2">The plan has ${steps.length} steps, but the limit is ${LIMITS.MAX_NODES}.</div></div>`,
      markdown: `**Plan too large:** ${steps.length} steps (limit: ${LIMITS.MAX_NODES}).`,
      timestamp: new Date(),
      json: { error: "node_count_limit", count: steps.length, limit: LIMITS.MAX_NODES },
    });
    return session;
  }

  let step = 0;
  for (const s of steps) {
    step++;
    const node: WorkflowNode = {
      id: `plan-${Date.now().toString(36)}-${step}`,
      type: "tool",
      label: s.label || s.tool_id,
      step_order: step,
      tool_id: s.tool_id,
      tool_parameters: s.tool_parameters,
    };

    // Persistent step marker — shows in the chat stream right before the step
    // runs, so the user can follow progress against the up-front plan list.
    const safeStepLabel = escapeHtml(s.label || s.tool_id);
    session.messages.push({
      id: `step-${Date.now().toString(36)}-${step}`,
      role: "assistant",
      source: "plan_executor",
      html: `<div class="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400 py-1"><span class="font-semibold text-ink-400 dark:text-white/50">Step ${step}</span><span class="font-mono">${safeStepLabel}</span></div>`,
      markdown: `Step ${step} \u00b7 \`${s.label || s.tool_id}\``,
      timestamp: new Date(),
      json: { kind: "step", tool: s.tool_id },
    } as any);
    await saveSession(databaseId, session);
    notifyClients(session.session_id, "new_message");

    const { hasError } = await executeNode(databaseId, node, session, "");
    if (hasError) {
      console.log(`[executePlanInSession] Step "${node.label}" failed — stopping plan`);
      break;
    }
    if (session.waitingForInput) {
      console.log(`[executePlanInSession] Paused at step "${node.label}" — waiting for input`);
      break;
    }
  }

  return session;
};

/**
 * Resume a scheduled workflow after manual start
 */
export const resumeScheduledWorkflow = async (
  databaseId: string,
  workflow: Workflow,
  session: Session
): Promise<Session> => {
  console.log(`[resumeScheduledWorkflow] Starting scheduled workflow: ${workflow.id}`);

  session.waitingForManualStart = false;
  session.metadata = session.metadata || {};
  session.metadata.hasStartedScheduled = true;

  return executeWorkflowActions(databaseId, workflow, session);
};

/**
 * Resume a paused workflow after user provides input.
 * Re-runs the paused node so it can read the submitted data and set output variables,
 * then continues to subsequent nodes.
 */
export const resumeWorkflow = async (
  databaseId: string,
  workflow: Workflow,
  session: Session,
  userResponse: string,
  variableName: string = "userInput"
): Promise<Session> => {
  console.log(`[resumeWorkflow] Resuming workflow with response: ${userResponse}`);

  if (!session.waitingForInput) {
    return session;
  }

  const workflowId = workflow.id;
  const execution = session.workflows?.[workflowId];
  const nodes = execution?.nodes || workflow.nodes;
  const pausedNodeId = execution?.pausedAt || session.metadata?.pausedAtNode;

  if (!pausedNodeId) {
    throw new Error("Cannot resume — the workflow doesn't have a paused step to continue from. Try running the workflow again.");
  }

  // Clear pause state
  session.waitingForInput = false;
  if (execution) execution.pauseReason = undefined;

  // Store user response as envelope
  session.parameters = session.parameters || [];
  const responseEnvelope = wrapInEnvelope(userResponse, 'form-response');
  session.parameters = setParameterValue(session.parameters, variableName, responseEnvelope);
  session.parameters = setParameterValue(session.parameters, 'lastPromptResponse', responseEnvelope);

  const safeResponse = escapeHtml(userResponse);
  session.messages.push({
    id: Date.now().toString(),
    role: "user",
    source: "workflow-prompt-response",
    html: `<div class="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
      <div class="text-sm text-blue-800 dark:text-blue-300">${safeResponse}</div>
    </div>`,
    markdown: userResponse,
    timestamp: new Date(),
    json: { variableName, response: userResponse }
  });

  // Find the paused node and resume FROM it (re-run so it can set output variables)
  const orderedNodes = getLinearOrder(nodes);
  const pausedIndex = orderedNodes.findIndex(n => n.id === pausedNodeId);

  if (pausedIndex === -1) {
    throw new Error("Cannot resume — the step that was paused no longer exists in the workflow. The workflow may have been modified. Try running it again.");
  }

  // Track total execution time for resumed portion
  const resumeStartTime = Date.now();

  // Re-run from the paused node (not pausedIndex + 1)
  for (let i = pausedIndex; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (!node.tool_id) continue;

    // Guard: total workflow duration (for resumed portion)
    const elapsed = Date.now() - resumeStartTime;
    if (elapsed > LIMITS.MAX_WORKFLOW_DURATION_MS) {
      const minutes = Math.round(elapsed / 60000);
      const safeLabel = escapeHtml(node.label || "Unknown");
      session.messages.push({
        id: Date.now().toString(),
        role: "error",
        source: "workflow_executor",
        nodeId: node.id,
        nodeLabel: node.label,
        html: `<div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4">
          <div class="text-red-800 dark:text-red-400 font-semibold">Workflow Timed Out</div>
          <div class="text-sm text-gray-700 dark:text-gray-300 mt-2">Stopped at step "${safeLabel}" after ${minutes} minutes (limit: ${LIMITS.MAX_WORKFLOW_DURATION_MS / 60000} min). Try splitting into smaller workflows.</div>
        </div>`,
        markdown: `**Workflow timed out** at step "${node.label}" after ${minutes} min. Try splitting into smaller workflows.`,
        timestamp: new Date(),
        json: { error: "workflow_timeout", elapsed_ms: elapsed },
      });
      break;
    }

    const { hasError } = await executeNode(databaseId, node, session, workflowId);

    if (hasError) {
      console.log(`[executor] Step "${node.label}" failed — stopping workflow`);
      break;
    }

    if (session.waitingForInput) {
      console.log(`[executor] Paused at step "${node.label}" — waiting for user input`);
      session.metadata = session.metadata || {};
      session.metadata.pausedAtNode = node.id;
      session.metadata.pausedAtStepOrder = node.step_order;
      if (session.workflows && session.workflows[workflowId]) {
        session.workflows[workflowId].pauseReason = "input";
        session.workflows[workflowId].pausedAt = node.id;
      }
      break;
    }

    if (node.type === "end" || node.tool_id === "workflow_end") {
      if (session.workflows && session.workflows[workflowId]) {
        session.workflows[workflowId].completedAt = new Date();
      }
      break;
    }
  }

  return session;
};

/**
 * Resume a workflow paused by `api.pauseForInput` (PauseSignal model).
 *
 * Unlike `resumeWorkflow` (which re-runs the paused node — used by the
 * legacy `upload_data` flow), this jumps to the NEXT node and stuffs the
 * submitted form fields into session.parameters keyed by field name.
 */
export const resumeAfterPause = async (
  databaseId: string,
  workflow: Workflow,
  session: Session,
  formValues: Record<string, string>,
): Promise<Session> => {
  if (!session.waitingForInput) return session;

  const pause = (session.metadata as any)?.pause;
  const pausedNodeId =
    pause?.nodeId ||
    session.workflows?.[workflow.id]?.pausedAt ||
    session.metadata?.pausedAtNode;

  if (!pausedNodeId) {
    throw new Error("Cannot resume — no pause state found on the session.");
  }

  // Inject each form field as a session parameter envelope.
  session.parameters = session.parameters || [];
  for (const [name, value] of Object.entries(formValues)) {
    const envelope = wrapInEnvelope(value, "form-input");
    session.parameters = setParameterValue(session.parameters, name, envelope);
  }

  // Replace the original form message with a "submitted" placeholder so the
  // form can't be re-submitted if the chat panel re-renders from the DB.
  const pauseMessageId = pause?.messageId;
  if (pauseMessageId) {
    const summary = Object.entries(formValues)
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
      .join("<br>");
    const idx = session.messages.findIndex((m: any) => m.id === pauseMessageId);
    if (idx !== -1) {
      session.messages[idx] = {
        ...session.messages[idx],
        html: `<div class="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm text-emerald-800 dark:text-emerald-300">
          <strong>Form submitted</strong>${summary ? `<div class="mt-1 text-xs opacity-80">${summary}</div>` : ""}
        </div>`,
      } as any;
    }
  }

  // Clear pause state.
  session.waitingForInput = false;
  if (session.metadata) {
    delete (session.metadata as any).pause;
    delete (session.metadata as any).pausedAtNode;
    delete (session.metadata as any).pausedAtStepOrder;
  }
  const execution = session.workflows?.[workflow.id];
  if (execution) {
    execution.pauseReason = undefined;
    execution.pausedAt = undefined;
  }

  // Record the user's submission in the chat for visibility.
  const safeJson = escapeHtml(JSON.stringify(formValues, null, 2));
  session.messages.push({
    id: Date.now().toString(),
    role: "user",
    source: "workflow-form-response",
    html: `<div class="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
      <pre class="text-xs text-blue-800 dark:text-blue-300 whitespace-pre-wrap">${safeJson}</pre>
    </div>`,
    markdown: "Form submitted:\n" +
      Object.entries(formValues)
        .map(([k, v]) => `- **${k}**: ${v}`)
        .join("\n"),
    timestamp: new Date(),
    json: { type: "form_response", values: formValues },
  });

  // Resume FROM the paused node (re-run so it can re-evaluate state and set output variables).
  const orderedNodes = getLinearOrder(execution?.nodes || workflow.nodes);
  const pausedIndex = orderedNodes.findIndex((n) => n.id === pausedNodeId);
  if (pausedIndex === -1) {
    throw new Error(
      "Cannot resume — paused step not found in the workflow. The workflow may have been modified.",
    );
  }

  const resumeStartTime = Date.now();

  for (let i = pausedIndex; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    if (!node.tool_id) continue;

    const elapsed = Date.now() - resumeStartTime;
    if (elapsed > LIMITS.MAX_WORKFLOW_DURATION_MS) {
      const minutes = Math.round(elapsed / 60000);
      session.messages.push({
        id: Date.now().toString(),
        role: "error",
        source: "workflow_executor",
        nodeId: node.id,
        nodeLabel: node.label,
        html: `<div class="text-red-600 text-sm">Workflow timed out after ${minutes} min.</div>`,
        markdown: `**Workflow timed out** after ${minutes} min.`,
        timestamp: new Date(),
        json: { error: "workflow_timeout", elapsed_ms: elapsed },
      } as any);
      break;
    }

    const { hasError } = await executeNode(databaseId, node, session, workflow.id);
    if (hasError) break;

    if (session.waitingForInput) {
      // The next node also paused — store its info and break.
      session.metadata = session.metadata || {};
      session.metadata.pausedAtNode = node.id;
      session.metadata.pausedAtStepOrder = node.step_order;
      if (session.workflows && session.workflows[workflow.id]) {
        session.workflows[workflow.id].pauseReason = "input";
        session.workflows[workflow.id].pausedAt = node.id;
      }
      break;
    }

    if (node.type === "end" || node.tool_id === "workflow_end") {
      if (session.workflows && session.workflows[workflow.id]) {
        session.workflows[workflow.id].completedAt = new Date();
      }
      session.instance_status = "awaiting_feedback";
      break;
    }
  }

  if (session.instance_status === "in_progress") {
    session.instance_status = "awaiting_feedback";
  }
  return session;
};
