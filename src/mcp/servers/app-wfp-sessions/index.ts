import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { declareResult } from "@mcp/outputs";

declareResult("show_message", { metaType: "text", tabular: false });
declareResult("chat_download", { metaType: "text", tabular: false });
declareResult("set_param", { metaType: "text", tabular: false });
declareResult("get_param", { metaType: "json_object", tabular: false });
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { MetaData } from "wfp-api";
import type { AddMessageArgs } from "@backend/types/chat";
import { rowsToCsv } from "@shared/wfp-api/csv";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { buildReportMessage, type ReportContentType } from "@core/tools/reportRenderer";
import { render, has, listTemplates } from "@frontend/templates/index";
import { WFP_META_TYPES } from "../../types";
import { extractTable } from "@data/table";

// ── AppHook (UI interaction injected by the chat orchestrator) ──────────

export interface AppHook {
  addMessage: (msg: AddMessageArgs) => Promise<void>;
  setParameter: (name: string, value: unknown, meta?: MetaData) => void;
  getParameter: (name: string) => unknown;
  getParameterMeta: (name: string) => MetaData | undefined;
}

let hook: AppHook | null = null;
let currentDatabaseId: string | null = null;
let currentSessionId: string | null = null;

export function setAppHook(h: AppHook) {
  hook = h;
}

export function setSessionDatabaseId(id: string) {
  currentDatabaseId = id;
}

export function setSessionId(id: string) {
  currentSessionId = id;
}

// ── Helpers ────────────────────────────────────────────────────────────

function requireWs() {
  if (!currentDatabaseId) throw new Error("No active workspace. Set databaseId via setSessionDatabaseId().");
  return getSessionByDatabaseId(currentDatabaseId)!;
}

function requireHook(): AppHook {
  if (!hook) throw new Error("App hook not registered. Call setAppHook() first.");
  return hook;
}

/** Serialize a stored param value server-side to CSV/JSON/text, so the model
 *  never has to round-trip table data through its own context. */
function serializeParamValue(
  name: string,
  value: unknown,
  meta?: MetaData,
): { content: string; type: "csv" | "json" | "text" | "html"; filename: string } {
  const t = meta?.type ?? "text";
  if (t === "json_array" || t === "csv") {
    if (Array.isArray(value)) {
      const rows = value as Record<string, unknown>[];
      return {
        content: rowsToCsv(rows, meta?.columns),
        type: "csv",
        filename: `${name}.csv`,
      };
    }
    return {
      content: JSON.stringify(value, null, 2),
      type: "json",
      filename: `${name}.json`,
    };
  }
  if (t === "json_object") {
    return {
      content: JSON.stringify(value, null, 2),
      type: "json",
      filename: `${name}.json`,
    };
  }
  const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  // A staged self-contained HTML report is delivered with an inline preview
  // (not a plain-text download) — detect it so the LLM doesn't have to remember
  // `content_type="html"` when it stored the report with `type="text"`.
  if (typeof value === "string" && /^\s*(<!doctype html|<html)/i.test(value)) {
    return { content, type: "html", filename: `${name}.html` };
  }
  return { content, type: "text", filename: `${name}.txt` };
}

// ── MCP Server ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: "app-wfp-sessions",
  version: "1.0.0",
});

// ── UI Tools ───────────────────────────────────────────────────────────

server.registerTool(
  "show_message",
  {
    description: "Renders a message in the chat stream visible to the user.",
    inputSchema: {
      markdown: z.string().optional().describe("Markdown text to display"),
      html: z.string().optional().describe("HTML content to render in the chat"),
    },
  },
  async ({ markdown, html }) => {
    await requireHook().addMessage({ markdown, html });
    return { content: [{ type: "text" as const, text: "Message displayed." }] };
  },
);

server.registerTool(
  "chat_download",
  {
    description: "Delivers a downloadable file in the chat. Use 'widget' + 'data' (JSON) to render a predefined widget server-side (e.g. account-table) — the LLM emits JSON, not HTML. Use 'data' alone for raw HTML content. Use 'param' to download a value previously stored with set_param (serialized server-side to CSV/JSON/text).",
    inputSchema: {
      widget: z.string().optional().describe("Widget/template name to render (e.g. 'account-table'). When set, 'data' is the widget's JSON payload."),
      data: z.string().optional().describe("Raw content to deliver (HTML report), or the JSON payload when 'widget' is set."),
      param: z.string().optional().describe("Name of a set_param value to download — serialized server-side, no need to re-emit the content."),
      filename: z.string().optional().describe("Download filename. Defaults based on content type (report.html, <name>.csv, <name>.json, <name>.txt, <widget>.html)."),
      content_type: z.enum(["html", "csv", "json", "text"]).optional().describe("Content type of the download. Defaults: 'data' -> html; 'param' -> inferred from the stored envelope type."),
    },
  },
  async ({ widget, data, param, filename, content_type }) => {
    const h = requireHook();
    let content: string;
    let type: ReportContentType;
    let resolvedFilename: string;

    if (widget) {
      if (!has(widget)) {
        return { content: [{ type: "text" as const, text: `Unknown widget "${widget}". Available: ${listTemplates().join(", ")}` }], isError: true };
      }
      let parsed: unknown;
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch {
        return { content: [{ type: "text" as const, text: `Invalid JSON for widget "${widget}": ${(data ?? "").slice(0, 200)}` }], isError: true };
      }
      content = render(widget, parsed, {
        databaseId: currentDatabaseId ?? "",
        sessionId: currentSessionId ?? "",
        messageId: "",
      });
      type = "html";
      resolvedFilename = filename ?? `${widget}.html`;
    } else if (param) {
      const value = h.getParameter(param);
      if (value === undefined || value === null) {
        return { content: [{ type: "text" as const, text: `Parameter "${param}" not found. Call set_param first to store the value.` }], isError: true };
      }
      const meta = h.getParameterMeta(param);
      const ser = serializeParamValue(param, value, meta);
      content = ser.content;
      type = content_type ?? ser.type;
      resolvedFilename = filename ?? ser.filename;
    } else if (data !== undefined && data !== null) {
      content = data;
      type = content_type ?? "html";
      resolvedFilename =
        filename ??
        (type === "html" ? "report.html" : type === "csv" ? "data.csv" : type === "json" ? "data.json" : "data.txt");
    } else {
      return { content: [{ type: "text" as const, text: "chat_download: provide 'widget'+'data', 'data', or 'param'." }], isError: true };
    }

    const { html, json } = buildReportMessage(content, resolvedFilename, currentSessionId ?? undefined, type);
    await h.addMessage({ html, json, id: json.messageId });
    return { content: [{ type: "text" as const, text: `File "${resolvedFilename}" delivered.` }] };
  },
);

server.registerTool(
  "set_param",
  {
    description: "Stores a typed value in the workflow session state using the WFP typed envelope system.",
    inputSchema: {
      name: z.string().describe("Parameter name"),
      value: z.string().describe("The value as a string. For numbers: pass the digits. For booleans: 'true'/'false'. For objects/arrays: pass a JSON string."),
      type: z.enum(WFP_META_TYPES).optional().default("string").describe("WFP envelope type — determines how downstream nodes interpret this value. Use 'number' for amounts/counts, 'json_array' for table data, 'json_object' for keyed records."),
      source: z.string().optional().describe("Provenance tag (e.g. 'user', 'mcp', 'tool:qbo')"),
      columns: z.array(z.string()).optional().describe("Column names — only meaningful when type is 'json_array' or 'csv'"),
      rowCount: z.number().optional().describe("Number of rows — only meaningful when type is 'json_array' or 'csv'"),
    },
  },
  async ({ name, value, type, source, columns, rowCount }) => {
    let parsed: unknown = value;

    if (type === "number") {
      const n = Number(value);
      if (isNaN(n)) return { content: [{ type: "text" as const, text: `Invalid number: "${value}"` }], isError: true };
      parsed = n;
    } else if (type === "boolean") {
      parsed = value === "true";
    } else if (type === "json_array") {
      try { parsed = JSON.parse(value); }
      catch { return { content: [{ type: "text" as const, text: `Invalid JSON for type "json_array": ${value.slice(0, 200)}` }], isError: true }; }
      const table = extractTable(parsed);
      if (table) parsed = table;
      else if (!Array.isArray(parsed)) {
        return { content: [{ type: "text" as const, text: "set_param: value is not an array for type json_array." }], isError: true };
      }
    } else if (type === "json_object") {
      try { parsed = JSON.parse(value); }
      catch { return { content: [{ type: "text" as const, text: `Invalid JSON for type "json_object": ${value.slice(0, 200)}` }], isError: true }; }
    }

    const meta: MetaData = { type };
    if (source) meta.source = source;
    if (columns) meta.columns = columns;
    if (rowCount !== undefined) meta.rowCount = rowCount;

    requireHook().setParameter(name, parsed, meta);
    return { content: [{ type: "text" as const, text: `Parameter "${name}" set as ${type}.` }] };
  },
);

server.registerTool(
  "get_param",
  {
    description: "Reads a stored value from the workflow session state. Returns the value with its WFP envelope type and metadata.",
    inputSchema: {
      name: z.string().describe("Parameter name to read"),
    },
  },
  async ({ name }) => {
    const h = requireHook();
    const value = h.getParameter(name);
    if (value === undefined || value === null) {
      return { content: [{ type: "text" as const, text: `Parameter "${name}" not found.` }], isError: true };
    }
    const meta = h.getParameterMeta(name);
    const result = meta
      ? { value, type: meta.type, ...(meta.columns ? { columns: meta.columns } : {}), ...(meta.rowCount !== undefined ? { rowCount: meta.rowCount } : {}) }
      : { value };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
  },
);

// ── Session CRUD ───────────────────────────────────────────────────────

server.registerTool(
  "list_sessions",
  {
    description: "Lists all saved sessions in the workspace. Shows name, status, kind, and timestamps.",
    inputSchema: {
      limit: z.number().optional().default(20).describe("Max sessions to return"),
    },
  },
  async ({ limit }) => {
    const ws = requireWs();
    const sessions = ws.getSessions()
      .sort((a, b) => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || ""))
      .slice(0, limit)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        status: s.status,
        workflow_id: s.workflow_id,
        message_count: s.messages?.length ?? 0,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    const text = sessions.length === 0
      ? "No sessions found in this workspace."
      : JSON.stringify(sessions, null, 2);
    return { content: [{ type: "text" as const, text }] };
  },
);

server.registerTool(
  "get_session",
  {
    description: "Gets a specific session including all messages.",
    inputSchema: {
      session_id: z.string().describe("Session ID to retrieve"),
    },
  },
  async ({ session_id }) => {
    const ws = requireWs();
    const session = ws.getSession(session_id);
    if (!session) {
      return { content: [{ type: "text" as const, text: `Session "${session_id}" not found.` }], isError: true };
    }
    const summary = {
      id: session.id,
      name: session.name,
      kind: session.kind,
      status: session.status,
      workflow_id: session.workflow_id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      completed_at: (session as any).completed_at ?? null,
      message_count: session.messages?.length ?? 0,
      messages: (session.messages ?? []).map((m: any) => ({
        role: m.role,
        timestamp: m.timestamp,
        preview: (m.markdown || m.html || "").slice(0, 300),
      })),
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
  },
);

server.registerTool(
  "delete_session",
  {
    description: "Deletes a session from the workspace.",
    inputSchema: {
      session_id: z.string().describe("Session ID to delete"),
    },
  },
  async ({ session_id }) => {
    const ws = requireWs();
    const deleted = ws.deleteSession(session_id);
    if (!deleted) {
      return { content: [{ type: "text" as const, text: `Session "${session_id}" not found or already deleted.` }] };
    }
    return { content: [{ type: "text" as const, text: `Session "${session_id}" deleted.` }] };
  },
);

// ── Init ───────────────────────────────────────────────────────────────

export async function initSessionsServer(transport: Transport) {
  await server.connect(transport);
}
