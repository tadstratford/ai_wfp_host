import type { Context } from "hono";
import {
  getSession,
  saveSession,
} from "@backend/core/session/sessions/session_all";
import { notifyClients } from "@backend/interfaces/streaming/simpleSSE";
import { getSessionByDatabaseId, requireSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import { render } from "@frontend/templates/index";
import type { User } from "@backend/types";
import { randomUUID } from "node:crypto";

export async function interactHandler(c: Context): Promise<Response> {
  const user = c.get("user") as User | undefined;
  if (!user?.currentDatabaseId || !user?.userId) {
    return c.text("Unauthorized", 401);
  }
  const databaseId = user.currentDatabaseId;

  const sessionId = c.req.param("sessionId") || "";
  if (!sessionId) return c.text("Missing sessionId", 400);

  let body: Record<string, string>;
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await c.req.json();
  } else {
    const form = await c.req.parseBody();
    body = {};
    for (const [k, v] of Object.entries(form)) {
      body[k] = typeof v === "string" ? v : String(v);
    }
  }

  const { messageId, action } = body;
  if (!messageId) return c.text("Missing messageId", 400);

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.text("Session not found", 404);

  const msgIdx = session.messages.findIndex((m: any) => m.id === messageId);
  if (msgIdx === -1) return c.text("Message not found", 404);

  const msg = session.messages[msgIdx];
  if (!msg.template) return c.text("Message has no template reference", 400);

  const templateData = msg.template_data ?? msg.data ?? {};
  const entities = (Array.isArray(templateData) ? templateData : (templateData as any).entities ?? []) as any[];

  let newData: any;

  // ── Entity actions ────────────────────────────────────────────────────
  switch (action) {
    case "add":
      newData = { entities, _add: true, _mode: "add" };
      break;
    case "cancel-add":
      newData = { entities, _mode: "view" };
      break;
    case "edit": {
      newData = { entities, _editId: body.id || "", _mode: "edit" };
      break;
    }
    case "cancel-edit":
      newData = { entities, _mode: "view" };
      break;
    case "add-save": {
      const code = (body.code || "").trim();
      const name = (body.name || "").trim();
      if (!code || !name) {
        newData = { entities, _add: true, _error: "Code and name are required." };
        break;
      }
      const ws = requireSessionByDatabaseId(databaseId);
      const glEntry = ws.getDataEntry("gl");
      const gl = (glEntry?.content_json || { entities: [], accounts: [], headers: [], lines: [], budgets: [], settings: {} }) as any;
      const exists = gl.entities.find((e: any) => e.code === code);
      if (exists) {
        newData = { entities, _add: true, _error: `Entity "${code}" already exists.` };
        break;
      }
      const newEntity = {
        id: randomUUID(),
        code,
        name,
        is_primary: body.isPrimary === "true",
        is_elimination: false,
        parent_entity_id: null,
        active: true,
      };
      gl.entities.push(newEntity);
      const now = new Date().toISOString();
      ws.setDataEntry("gl", {
        content: JSON.stringify(gl),
        content_type: "json_object",
        content_json: gl,
        group: "gl",
        edited_at: now,
      });
      newData = { entities: gl.entities, _mode: "view" };
      break;
    }
    case "edit-save": {
      const id = body.id || "";
      const ws = requireSessionByDatabaseId(databaseId);
      const glEntry = ws.getDataEntry("gl");
      const gl = (glEntry?.content_json || { entities: [], accounts: [], headers: [], lines: [], budgets: [], settings: {} }) as any;
      const entity = gl.entities.find((e: any) => e.id === id);
      if (!entity) {
        newData = { entities, _error: `Entity "${id}" not found.` };
        break;
      }
      if (body.name !== undefined) entity.name = (body.name || "").trim();
      if (body.isPrimary !== undefined) entity.is_primary = body.isPrimary === "true";
      if (body.active !== undefined) entity.active = body.active === "true";
      const now = new Date().toISOString();
      ws.setDataEntry("gl", {
        content: JSON.stringify(gl),
        content_type: "json_object",
        content_json: gl,
        group: "gl",
        edited_at: now,
      });
      newData = { entities: gl.entities, _mode: "view" };
      break;
    }
    case "delete": {
      const id = body.id || "";
      if (!id) { newData = { entities, _mode: "view" }; break; }
      const ws = requireSessionByDatabaseId(databaseId);
      const glEntry = ws.getDataEntry("gl");
      const gl = (glEntry?.content_json || { entities: [], accounts: [], headers: [], lines: [], budgets: [], settings: {} }) as any;
      const entity = gl.entities.find((e: any) => e.id === id);
      if (!entity) { newData = { entities, _mode: "view" }; break; }
      const hasJournals = gl.headers?.some((h: any) => h.entity_id === id);
      if (hasJournals) {
        entity.active = false;
      } else {
        gl.entities = gl.entities.filter((e: any) => e.id !== id);
      }
      const now = new Date().toISOString();
      ws.setDataEntry("gl", {
        content: JSON.stringify(gl),
        content_type: "json_object",
        content_json: gl,
        group: "gl",
        edited_at: now,
      });
      newData = { entities: gl.entities, _mode: "view" };
      break;
    }
    case "csv": {
      if (entities.length === 0) return c.text("No entities to export.", 400);
      const header = "code,name,is_primary,is_elimination,active\n";
      const rows = entities.map((e: any) =>
        `"${escCsv(e.code || "")}","${escCsv(e.name || "")}",${e.is_primary ? "yes" : "no"},${e.is_elimination ? "yes" : "no"},${e.active !== false ? "yes" : "no"}`
      ).join("\n");
      return c.newResponse(header + rows, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="entities.csv"`,
      });
    }
    case "report": {
      const rows = entities.map((e: any) =>
        `<tr><td>${escHtml(e.code || "")}</td><td>${escHtml(e.name || "")}</td><td>${e.is_primary ? "Yes" : "No"}</td><td>${e.active !== false ? "Active" : "Inactive"}</td></tr>`
      ).join("\n");
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Entity Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px}
h1{font-size:1.5rem;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #ddd}
th{background:#f5f5f5;font-weight:600}</style></head>
<body><h1>Entity Report</h1><table><thead><tr><th>Code</th><th>Name</th><th>Primary</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table><p style="margin-top:1rem;color:#666;font-size:0.875rem">
Generated: ${new Date().toISOString()} | ${entities.length} entit${entities.length === 1 ? "y" : "ies"}</p></body></html>`;
      return c.html(html);
    }
    case "drill": {
      const ws = getSessionByDatabaseId(databaseId);
      let detail = null;
      if (ws && body.acct) {
        const glEntry = ws.getDataEntry("gl");
        const gl = glEntry?.content_json as any;
        detail = gl?.accounts?.find((a: any) => a.account === body.acct) || null;
      }
      newData = { entities, _detail: detail };
      break;
    }
    default:
      newData = { entities, _mode: "view" };
  }

  const html = render(msg.template, newData, { databaseId, sessionId, messageId });

  // Update both template_data and html so the message survives page refresh
  session.messages[msgIdx] = {
    ...session.messages[msgIdx],
    template_data: newData,
    html,
  };
  await saveSession(databaseId, session);

  // Don't fire SSE — HTMX already swapped the content inline via hx-swap
  return c.html(html);
}

// ── GET handlers for CSV and Report (direct links, not HTMX) ────────────────

export async function entityCsvHandler(c: Context): Promise<Response> {
  const user = c.get("user") as User | undefined;
  if (!user?.currentDatabaseId) return c.text("Unauthorized", 401);
  const databaseId = user.currentDatabaseId;
  const sessionId = c.req.param("sessionId") || "";
  const messageId = c.req.param("messageId") || "";
  if (!sessionId || !messageId) return c.text("Missing params", 400);

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.text("Session not found", 404);
  const msg = session.messages.find((m: any) => m.id === messageId);
  if (!msg) return c.text("Message not found", 404);

  const td = msg.template_data ?? msg.data ?? {};
  const entities = (Array.isArray(td) ? td : (td as any).entities ?? []) as any[];
  if (entities.length === 0) return c.text("No entities to export.", 400);

  const header = "code,name,is_primary,is_elimination,active\n";
  const rows = entities.map((e: any) =>
    `"${escCsv(e.code || "")}","${escCsv(e.name || "")}",${e.is_primary ? "yes" : "no"},${e.is_elimination ? "yes" : "no"},${e.active !== false ? "yes" : "no"}`
  ).join("\n");
  return c.newResponse(header + rows, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="entities.csv"`,
  });
}

export async function entityReportHandler(c: Context): Promise<Response> {
  const user = c.get("user") as User | undefined;
  if (!user?.currentDatabaseId) return c.text("Unauthorized", 401);
  const databaseId = user.currentDatabaseId;
  const sessionId = c.req.param("sessionId") || "";
  const messageId = c.req.param("messageId") || "";
  if (!sessionId || !messageId) return c.text("Missing params", 400);

  const session = await getSession(databaseId, sessionId);
  if (!session) return c.text("Session not found", 404);
  const msg = session.messages.find((m: any) => m.id === messageId);
  if (!msg) return c.text("Message not found", 404);

  const td = msg.template_data ?? msg.data ?? {};
  const entities = (Array.isArray(td) ? td : (td as any).entities ?? []) as any[];

  const rows = entities.map((e: any) =>
    `<tr><td>${escHtml(e.code || "")}</td><td>${escHtml(e.name || "")}</td><td>${e.is_primary ? "Yes" : "No"}</td><td>${e.active !== false ? "Active" : "Inactive"}</td></tr>`
  ).join("\n");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Entity Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px}
h1{font-size:1.5rem;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #ddd}
th{background:#f5f5f5;font-weight:600}</style></head>
<body><h1>Entity Report</h1><table><thead><tr><th>Code</th><th>Name</th><th>Primary</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table><p style="margin-top:1rem;color:#666;font-size:0.875rem">
Generated: ${new Date().toISOString()} | ${entities.length} entit${entities.length === 1 ? "y" : "ies"}</p></body></html>`;
  return c.html(html);
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escCsv(s: string): string {
  return s.replace(/"/g, '""');
}
