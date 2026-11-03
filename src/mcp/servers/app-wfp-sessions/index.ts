import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { declareResult } from "@mcp/outputs";

declareResult("show_message", { metaType: "text", tabular: false });
declareResult("chat_download", { metaType: "text", tabular: false });
declareResult("export_workbook", { metaType: "text", tabular: false });
declareResult("view_workbook", { metaType: "text", tabular: false });
declareResult("build_workbook", { metaType: "text", tabular: false });
declareResult("export_qbo_pnl", { metaType: "text", tabular: false });
declareResult("export_qbo_bs", { metaType: "text", tabular: false });
declareResult("set_param", { metaType: "text", tabular: false });
declareResult("get_param", { metaType: "json_object", tabular: false });
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { MetaData } from "wfp-api";
import type { AddMessageArgs } from "@backend/types/chat";
import { rowsToCsv } from "@shared/wfp-api/csv";
import { buildWorkbook, readSheetNames, rowsToGrid, type WorkbookSheet } from "@shared/wfp-api/xlsx";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { getSession } from "@backend/core/session/sessions/session_all";
import { buildReportMessage, type ReportContentType, type WorkbookView } from "@core/tools/reportRenderer";
import { render, has, listTemplates } from "@frontend/templates/index";
import { WFP_META_TYPES } from "../../types";
import { extractTable } from "@data/table";
import { listTabularEntries } from "@data/workbookSheets";
import {
  setScope,
  requireScope,
  notConnected,
  fetchReportWithFallback,
  monthlyPnl,
  statementInput,
  workspaceContext,
} from "@capabilities/qbo/scope";
import { QBOClient, checkQBOConnected } from "@capabilities/qbo/client";
import { buildQboStatementWorkbook, statementPreview } from "@capabilities/qbo/statementXlsx";
import type { QboStatementInput } from "@capabilities/qbo/statementReport";

/** Cap the inline preview grid so very large tables render as a preview, with
 *  the full data available via the workbook download. */
const PREVIEW_ROW_CAP = 500;

/** Build the capped inline `preview` plus the full `workbook` payload (all rows)
 *  in one pass — the preview feeds the chat stream, the workbook feeds the
 *  standalone `/sessions/workbook` tab. */
function buildGridPayload(sheets: WorkbookSheet[]): { preview: Record<string, unknown>; workbook: WorkbookView } {
  const full = sheets.map((s) => {
    const grid = rowsToGrid(s.rows, s.columns);
    return { name: s.name, columns: grid.columns, rows: grid.rows, total: grid.total };
  });
  return {
    preview: {
      kind: "workbook",
      sheets: full.map((f) => ({ ...f, rows: f.rows.slice(0, PREVIEW_ROW_CAP) })),
    },
    workbook: { sheets: full },
  };
}

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

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Serialize a stored param value server-side to CSV/JSON/text/HTML/xlsx, so the
 *  model never has to round-trip table data through its own context. */
function serializeParamValue(
  name: string,
  value: unknown,
  meta?: MetaData,
  asType?: "csv" | "json" | "text" | "html" | "xlsx",
): { content: string | Buffer; type: "csv" | "json" | "text" | "html" | "xlsx"; filename: string } {
  const t = meta?.type ?? "text";
  if (asType === "xlsx") {
    const rows = extractTable(value);
    if (!Array.isArray(rows)) {
      throw new Error(
        `Cannot serialize "${name}" (${t}) as xlsx — the stored value is not tabular.`,
      );
    }
    return {
      content: buildWorkbook([{ name, rows: rows as Record<string, unknown>[], columns: meta?.columns }]),
      type: "xlsx",
      filename: `${name}.xlsx`,
    };
  }
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
    description: "Delivers a downloadable file in the chat. Use 'widget' + 'data' (JSON) to render a predefined widget server-side (e.g. account-table) — the LLM emits JSON, not HTML. Use 'data' alone for raw HTML content. Use 'param' to download a value previously stored with set_param (serialized server-side to CSV/JSON/text/xlsx). Use 'param' + content_type='xlsx' to emit a single-sheet Excel workbook from a stored table.",
    inputSchema: {
      widget: z.string().optional().describe("Widget/template name to render (e.g. 'account-table'). When set, 'data' is the widget's JSON payload."),
      data: z.string().optional().describe("Raw content to deliver (HTML report), or the JSON payload when 'widget' is set."),
      param: z.string().optional().describe("Name of a set_param value to download — serialized server-side, no need to re-emit the content."),
      filename: z.string().optional().describe("Download filename. Defaults based on content type (report.html, <name>.csv, <name>.json, <name>.txt, <name>.xlsx, <widget>.html)."),
      content_type: z.enum(["html", "csv", "json", "text", "xlsx"]).optional().describe("Content type of the download. Defaults: 'data' -> html; 'param' -> inferred from the stored envelope type. 'xlsx' only meaningful with 'param'."),
    },
  },
  async ({ widget, data, param, filename, content_type }) => {
    const h = requireHook();
    let content: string | Buffer;
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
      try {
        const ser = serializeParamValue(param, value, meta, content_type ?? undefined);
        content = ser.content;
        type = content_type ?? ser.type;
        resolvedFilename = filename ?? ser.filename;
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: err.message }], isError: true };
      }
    } else if (data !== undefined && data !== null) {
      content = data;
      type = content_type ?? "html";
      resolvedFilename =
        filename ??
        (type === "html" ? "report.html" : type === "csv" ? "data.csv" : type === "json" ? "data.json" : type === "xlsx" ? "data.xlsx" : "data.txt");
    } else {
      return { content: [{ type: "text" as const, text: "chat_download: provide 'widget'+'data', 'data', or 'param'." }], isError: true };
    }

    let preview: Record<string, unknown> | undefined;
    let workbook: WorkbookView | undefined;
    if (type === "xlsx" && param) {
      const rows = extractTable(h.getParameter(param));
      if (Array.isArray(rows)) {
        const grid = buildGridPayload([
          { name: param, rows: rows as Record<string, unknown>[], columns: h.getParameterMeta(param)?.columns },
        ]);
        preview = grid.preview;
        workbook = grid.workbook;
      }
    }

    const { html, json } = buildReportMessage(content, resolvedFilename, currentSessionId ?? undefined, type, undefined, preview, workbook);
    await h.addMessage({ html, json, id: json.messageId });
    return { content: [{ type: "text" as const, text: `File "${resolvedFilename}" delivered.` }] };
  },
);

server.registerTool(
  "export_workbook",
  {
    description: "Builds a multi-sheet Excel (.xlsx) workbook from this chat session: a 'Transcript' sheet (role/source/timestamp/text) plus one sheet per tabular workspace data file (or the names you list). Delivers a download button and an inline read-only grid preview. Use when the user asks to export the session/analysis to Excel.",
    inputSchema: {
      filename: z.string().optional().describe("Download filename. Defaults to 'workbook.xlsx'."),
      include_transcript: z.boolean().optional().describe("Include a 'Transcript' sheet of the chat messages. Defaults to true."),
      data_names: z.array(z.string()).optional().describe("Workspace data names to include (one sheet each). Defaults to every tabular (csv/json_array) data file."),
    },
  },
  async ({ filename, include_transcript, data_names }) => {
    const h = requireHook();
    if (!currentDatabaseId) {
      return { content: [{ type: "text" as const, text: "No active workspace." }], isError: true };
    }

    const ws = requireWs();
    const sheets: WorkbookSheet[] = [];

    if (include_transcript !== false) {
      let messages: any[] = [];
      if (currentSessionId) {
        const chat = await getSession(currentDatabaseId, currentSessionId);
        messages = chat?.messages ?? [];
      }
      const rows = messages.map((m: any) => ({
        Role: m.role ?? "",
        Source: m.source ?? "",
        Timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : "",
        Text: (m.markdown || stripHtml(m.html) || "").slice(0, 10000),
      }));
      sheets.push({ name: "Transcript", rows, columns: ["Role", "Source", "Timestamp", "Text"] });
    }

    let names: string[];
    if (data_names && data_names.length > 0) {
      names = data_names;
    } else {
      names = listTabularEntries(ws).map((e) => e.name);
    }

    for (const n of names) {
      const e = ws.getDataEntry(n);
      if (!e) {
        return { content: [{ type: "text" as const, text: `Data "${n}" not found in the workspace.` }], isError: true };
      }
      const rows = extractTable(e.content_json ?? e.content);
      if (!Array.isArray(rows)) continue;
      sheets.push({ name: n, rows: rows as Record<string, unknown>[], columns: e.columns });
    }

    if (sheets.length === 0) {
      return { content: [{ type: "text" as const, text: "Nothing to export — no transcript and no tabular data in this session." }], isError: true };
    }

    const buf = buildWorkbook(sheets);
    const resolvedFilename = filename ?? "workbook.xlsx";
    const messageId = Date.now().toString();
    const { preview, workbook } = buildGridPayload(sheets);
    const { html, json } = buildReportMessage(buf, resolvedFilename, currentSessionId ?? undefined, "xlsx", messageId, preview, workbook);
    await h.addMessage({ html, json, id: messageId });
    return { content: [{ type: "text" as const, text: `Workbook "${resolvedFilename}" delivered.` }] };
  },
);

/** Deliver a formatted QBO statement workbook (download button + inline grid
 *  preview) through the same pipeline `export_workbook` uses. */
async function deliverQboStatement(
  h: AppHook,
  input: QboStatementInput,
  filename: string,
): Promise<string> {
  const buf = await buildQboStatementWorkbook(input);
  const messageId = Date.now().toString();
  const grid = statementPreview(input);
  const fullSheet = { name: input.title, columns: grid.columns, rows: grid.rows, total: grid.total };
  const preview = {
    kind: "workbook",
    sheets: [{ ...fullSheet, rows: fullSheet.rows.slice(0, PREVIEW_ROW_CAP) }],
  };
  const workbook: WorkbookView = { sheets: [fullSheet] };
  const { html, json } = buildReportMessage(buf, filename, currentSessionId ?? undefined, "xlsx", messageId, preview, workbook);
  await h.addMessage({ html, json, id: messageId });
  return `Workbook "${filename}" delivered.`;
}

/** Resolve the QBO scope for the active workspace, returning a connected client
 *  or the "not connected" payload (as an MCP error/text) when unlinked. */
async function resolveQboClient(): Promise<QBOClient | null> {
  if (!currentDatabaseId) throw new Error("No active workspace.");
  setScope(currentDatabaseId);
  const scope = requireScope();
  if (!(await checkQBOConnected(scope))) return null;
  const client = new QBOClient(scope);
  await client.connect();
  return client;
}

server.registerTool(
  "export_qbo_pnl",
  {
    description: "Fetches the QuickBooks Online Profit & Loss report and delivers it as a formatted single-sheet Excel (.xlsx) workbook — bold section headers, indented line items, ruled subtotals, and currency-formatted numeric cells. Deterministic — no LLM. Use when the user asks for the P&L as an Excel workbook. summarize_column_by \"Months\" renders month-by-month columns.",
    inputSchema: {
      start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
      end_date: z.string().describe("Report end date (YYYY-MM-DD)"),
      summarize_column_by: z.enum(["Total", "Days", "Weeks", "Months", "Quarterly", "Annual"]).optional().describe("Column grouping. Use \"Months\" for a month-by-month breakdown. Defaults to \"Total\"."),
      accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
      filename: z.string().optional().describe("Download filename. Defaults to 'profit-and-loss.xlsx'."),
    },
  },
  async ({ start_date, end_date, summarize_column_by, accounting_method, filename }) => {
    const h = requireHook();
    const client = await resolveQboClient();
    if (!client) return notConnected();

    const method = accounting_method ?? "Accrual";
    const columnBy = summarize_column_by ?? "Total";

    let input: QboStatementInput;
    if (columnBy === "Months") {
      try {
        const report = await client.profitAndLoss(start_date, end_date, {
          summarizeColumnBy: "Months",
          accountingMethod: method,
        });
        input = statementInput(report, "Profit and Loss", method, null);
      } catch {
        const { columns, rows, currency } = await monthlyPnl(client, start_date, end_date, method);
        input = {
          ...workspaceContext(),
          title: "Profit and Loss",
          period: `${start_date} – ${end_date}`,
          currency,
          accountingMethod: method,
          columns,
          rows,
          note: null,
        };
      }
    } else {
      const { report, note } = await fetchReportWithFallback(client, "pnl", start_date, end_date, columnBy, method);
      input = statementInput(report, "Profit and Loss", method, note);
    }

    const text = await deliverQboStatement(h, input, filename ?? "profit-and-loss.xlsx");
    return { content: [{ type: "text" as const, text }] };
  },
);

server.registerTool(
  "export_qbo_bs",
  {
    description: "Fetches the QuickBooks Online Balance Sheet report and delivers it as a formatted single-sheet Excel (.xlsx) workbook — bold section headers, indented line items, ruled subtotals, and currency-formatted numeric cells. Deterministic — no LLM. Use when the user asks for the balance sheet as an Excel workbook.",
    inputSchema: {
      start_date: z.string().describe("Report start date (YYYY-MM-DD)"),
      end_date: z.string().describe("Report end date (YYYY-MM-DD). For an as-of snapshot, use the same value as start_date."),
      summarize_column_by: z.enum(["Total", "Days", "Weeks", "Months", "Quarterly", "Annual"]).optional().describe("Column grouping. Defaults to \"Total\" (single as-of column)."),
      accounting_method: z.enum(["Accrual", "Cash"]).optional().describe("Accounting basis. Defaults to \"Accrual\"."),
      filename: z.string().optional().describe("Download filename. Defaults to 'balance-sheet.xlsx'."),
    },
  },
  async ({ start_date, end_date, summarize_column_by, accounting_method, filename }) => {
    const h = requireHook();
    const client = await resolveQboClient();
    if (!client) return notConnected();

    const method = accounting_method ?? "Accrual";
    const { report, note } = await fetchReportWithFallback(
      client, "balance", start_date, end_date, summarize_column_by ?? "Total", method,
    );
    const input = statementInput(report, "Balance Sheet", method, note);

    const text = await deliverQboStatement(h, input, filename ?? "balance-sheet.xlsx");
    return { content: [{ type: "text" as const, text }] };
  },
);

server.registerTool(
  "view_workbook",
  {
    description: "Renders an uploaded Excel workbook inline in the chat as a read-only spreadsheet with one tab per sheet (no formatting). Reads the parsed sheets so it needs no re-parsing of the original file. Use when the user asks to see/open a workbook they uploaded.",
    inputSchema: {
      name: z.string().describe("Workbook base name (e.g. 'budget2025', or its 'source_budget2025' entry)."),
    },
  },
  async ({ name }) => {
    const h = requireHook();
    if (!currentDatabaseId) {
      return { content: [{ type: "text" as const, text: "No active workspace." }], isError: true };
    }

    const ws = requireWs();
    const base = name.replace(/^source_/, "");
    const sourceName = `source_${base}`;
    const source = ws.getDataEntry(sourceName);
    if (!source || source.content_type !== "xlsx" || typeof source.content !== "string") {
      return { content: [{ type: "text" as const, text: `Workbook "${base}" not found. Upload it via the Data page first.` }], isError: true };
    }

    // Resolve sheet names + order from the preserved original .xlsx.
    const sheetNames = readSheetNames(Buffer.from(source.content, "base64"));
    const sheets: WorkbookSheet[] = [];
    for (const sheetName of sheetNames) {
      const sanitized = sheetName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const entryName = `${base}_${sanitized}`;
      const entry = ws.getDataEntry(entryName);
      if (!entry) continue;
      const rows = extractTable(entry.content_json ?? entry.content);
      if (!Array.isArray(rows)) continue;
      sheets.push({ name: sheetName, rows: rows as Record<string, unknown>[], columns: entry.columns });
    }

    if (sheets.length === 0) {
      return { content: [{ type: "text" as const, text: `Workbook "${base}" has no parsed sheets to show.` }], isError: true };
    }

    const messageId = Date.now().toString();
    const { preview, workbook } = buildGridPayload(sheets);

    const downloadHref = `/workspace/api/data/${encodeURIComponent(sourceName)}/download`;
    const downloadBtn = `<a href="${downloadHref}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;font-family:sans-serif;">Download original</a>`;
    const openTabBtn = currentSessionId
      ? `<a href="/sessions/workbook?session_id=${encodeURIComponent(currentSessionId)}&id=${encodeURIComponent(messageId)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#fff;color:#2563eb;border:2px solid #2563eb;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;font-family:sans-serif;margin-left:8px;">Open in new tab</a>`
      : "";
    const html = `<div><div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${downloadBtn}${openTabBtn}</div></div>`;
    await h.addMessage({
      id: messageId,
      html,
      json: { kind: "workbook", preview, workbook, reportHtml: "", messageId, contentType: "xlsx", sourceName },
    });
    return { content: [{ type: "text" as const, text: `Workbook "${base}" rendered inline (${sheets.length} sheets).` }] };
  },
);

server.registerTool(
  "build_workbook",
  {
    description: "Opens the interactive workbook builder in a new tab. The user picks which of the workspace's tabular data tables become sheets in a read-only spreadsheet, then downloads the selection as a single .xlsx workbook. Use when the user asks to build/assemble a multi-table Excel workbook from their data (e.g. 'make me an interco analysis workbook').",
    inputSchema: {
      data_names: z.array(z.string()).optional().describe("Optional workspace data names to pre-check in the builder."),
    },
  },
  async ({ data_names }) => {
    const h = requireHook();
    const messageId = Date.now().toString();
    const preselect = data_names && data_names.length > 0
      ? `?names=${encodeURIComponent(data_names.join(","))}`
      : "";
    const openBtn = `<a href="/sessions/workbook-builder${preselect}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;border:2px solid #2563eb;">Open workbook builder</a>`;
    const html = `<div><div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${openBtn}</div></div>`;
    await h.addMessage({
      id: messageId,
      html,
      json: { kind: "workbook-builder", messageId },
    });
    return { content: [{ type: "text" as const, text: "Workbook builder opened — the user selects tables and downloads the .xlsx in the new tab." }] };
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
