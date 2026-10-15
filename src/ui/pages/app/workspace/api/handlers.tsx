import { Context } from "hono";
import * as XLSX from "xlsx";
import { previewWorkspace } from "@backend/core/workspace/preview";
import { encryptWorkspace } from "@backend/core/workspace/crypto";
import {
  getSessionByDatabaseId,
  requireSessionByDatabaseId,
} from "@backend/core/workspace/workspaceSessionStore";
import { openDiskWorkspace, WorkspaceOpenError } from "@backend/core/workspace/workspaceLifecycle";
import {
  listUserData,
  loadUserData,
  detectContentMeta,
  deleteUserData,
  getUserData,
  updateUserData,
} from "@backend/core/user-data/index";
import { gridToCellMap } from "@backend/core/user-data/stage";
import { recognizeQboReport, looksLikeQbo } from "@data/qbo/recognize";
import { detectQboFromContent } from "@data/qbo/ingest";
import { parseQboReport, qboReportToCsv, qboEntrySuffix } from "@data/qbo/toTable";
import { userManager } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import { logActivity } from "@backend/core/models/activityTracker";

// ── GET /workspace/export ─────────────────────────────────────────────────────
// Plain (unencrypted) download — also handles ?then=logout redirect.

export const workspaceExportHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.text("No workspace is open", 400);
  const wfp = session.exportWfpSnapshot();
  if (session.getWorkspaceName()) wfp.metadata.workspace = session.getWorkspaceName();

  // Optional slim export: ?strip=logs,sessions drops those top-level sections
  // from the .wfp (e.g. a backup without run logs or chat history).
  const strip = new Set(
    (c.req.queries("strip") ?? [c.req.query("strip") ?? ""])
      .flatMap((s) => s.split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (strip.has("logs")) delete wfp.logs;
  if (strip.has("sessions")) delete wfp.sessions;

  const content = JSON.stringify(wfp);

  const date = new Date().toISOString().slice(0, 10);
  const safeName = (wfp.metadata.workspace || "workspace").replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "workspace";
  const stripSuffix =
    strip.has("logs") && strip.has("sessions")
      ? "-no-logs-sessions"
      : strip.has("logs")
        ? "-no-logs"
        : strip.has("sessions")
          ? "-no-sessions"
          : "";
  const filename = `${safeName}_${date}${stripSuffix}.wfp`;

  // After download, redirect if ?then=logout
  const then = c.req.query("then");
  if (then === "logout") {
    return c.html(
      `<!DOCTYPE html><html><head></head><body>
      <p style="font-family:sans-serif;padding:2rem">Downloading backup… redirecting to logout.</p>
      <script>
        fetch('/app/workspace/api/export',{credentials:'same-origin'})
          .then(function(r){return r.blob()})
          .then(function(blob){
            var a=document.createElement('a');
            a.href=URL.createObjectURL(blob);
            a.download=${JSON.stringify(filename)};
            document.body.appendChild(a);a.click();
            URL.revokeObjectURL(a.href);
            setTimeout(function(){window.location.href='/auth/logout'},600);
          })
          .catch(function(){window.location.href='/auth/logout'});
      </script>
      </body></html>` as any,
    );
  }

  logActivity(user.userEmail, "workspace_export", user.workspaceName, user.userId);
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(content);
};

// ── POST /workspace/export ────────────────────────────────────────────────────
// Encrypted download — passphrase from form body.

export const workspaceExportEncryptedHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const body = await c.req.parseBody();
  const passphrase = (body["passphrase"] as string | undefined)?.trim();
  if (!passphrase) return c.text("Passphrase is required", 400);

  const session = getSessionByDatabaseId(databaseId);
  if (!session) return c.text("No workspace is open", 400);
  const wfp = session.exportWfpSnapshot();
  if (session.getWorkspaceName()) wfp.metadata.workspace = session.getWorkspaceName();
  const plaintext = JSON.stringify(wfp);
  const encrypted = encryptWorkspace(plaintext, passphrase);

  const date = new Date().toISOString().slice(0, 10);
  const safeName = (wfp.metadata.workspace || "workspace").replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "workspace";
  const filename = `${safeName}_${date}.wfp`;

  c.header("Content-Type", "application/octet-stream");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(encrypted);
};

// ── POST /workspace/import ───────────────────────────────────────────────────

export const workspaceImportHandler = async (c: Context) => {
  const user = c.get("user") as User;
  let databaseId = user.currentDatabaseId;

  if (!databaseId) {
    databaseId = crypto.randomUUID();
    await userManager.assignDatabaseId(user.userId, databaseId);
  }

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") return c.text("No file uploaded", 400);

  const passphrase = (body["passphrase"] as string | undefined)?.trim() || undefined;
  const content = await (file as File).text();
  const sourceFilename = (file as File).name || "workspace.wfp";

  try {
    const session = await openDiskWorkspace({
      userId: user.userId,
      databaseId,
      fileContent: content,
      passphrase,
      sourceFilename,
    });
    logActivity(user.userEmail, "workspace_import", session.getWorkspaceName(), user.userId);
  } catch (err) {
    if (err instanceof WorkspaceOpenError) {
      return c.text(err.message, err.kind === "wrong_secret" ? 400 : 500);
    }
    return c.text(err instanceof Error ? err.message : "Import failed.", 500);
  }

  c.header("HX-Trigger", "workspaceImported");
  return c.text("OK", 200);
};

// ─��� POST /workspace/import/preview ───────────────────────────────────────────

export const workspacePreviewHandler = async (c: Context) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") return c.json({ error: "No file uploaded" }, 400);

  const content = await (file as File).text();

  try {
    const preview = previewWorkspace(content);
    return c.json(preview);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to preview file.";
    return c.json({ error: msg }, 400);
  }
};

// ── POST /workspace/new ──────────────────────────────────────────────────────

// Superseded by /app/workspaces/new (M11b). Tells legacy callers to use the
// new flow.
export const workspaceNewHandler = async (c: Context) => {
  c.header("HX-Redirect", "/app/workspaces/modal/new");
  return c.text("Use /app/workspaces to create a new workspace.", 410);
};

// ── POST /workspace/data/load ────────────────────────────────────────────────

/** Native cell-address map ({ "a1": value, "b5": value, … }) from a worksheet. */
function worksheetToCellMap(ws: XLSX.WorkSheet): {
  cells: Record<string, string>;
  rowCount: number;
} {
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const grid = (aoa as unknown[][]).map((row) =>
    (row ?? []).map((v) => (v === null || v === undefined ? "" : String(v))),
  );
  const { cells, rowCount } = gridToCellMap(grid);
  return { cells, rowCount };
}

export const userDataLoadHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") return c.text("No file uploaded", 400);

  let name = (body["name"] as string | undefined)?.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!name) {
    const fileName = (file as File).name;
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    name = base.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }
  if (!name) return c.text("Name is required", 400);

  // Block reserved section names
  const RESERVED = new Set([
    "meta", "app_workflows", "app_sessions", "app_custom_tools",
    "wf_mgmt_step_tracking", "wf_mgmt_approvals", "wf_mgmt_actions",
  ]);
  if (RESERVED.has(name)) {
    return c.text(`"${name}" is a reserved name`, 400);
  }

  const sourceFilename = (file as File).name;
  const isExcel =
    sourceFilename.endsWith(".xlsx") ||
    sourceFilename.endsWith(".xls") ||
    sourceFilename.endsWith(".xlsm");

  const recognized: { label: string; entryName: string }[] = [];

  try {
    if (isExcel) {
      const arrayBuffer = await (file as File).arrayBuffer();
      const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });

      for (const sheetName of workbook.SheetNames) {
        const sanitizedSheet = sheetName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
        const entryName = `${name}_${sanitizedSheet}`;
        const ws = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws);

        // QBO report sheet → parse to a normalized CSV table (`<name>_qbo_<kind>`).
        // Cheap title pre-check first, so we don't build a cell map for ordinary sheets.
        if (looksLikeQbo(csv)) {
          const { cells } = worksheetToCellMap(ws);
          const rec = recognizeQboReport(cells);
          if (rec) {
            const report = parseQboReport(rec.kind, cells, sourceFilename);
            const qboName = `${name}_qbo_${qboEntrySuffix(rec.kind)}`;
            await loadUserData(
              databaseId,
              qboName,
              qboReportToCsv(rec.kind, report),
              sourceFilename,
            );
            recognized.push({ label: rec.label, entryName: qboName });
            continue;
          }
        }

        // Simple table → CSV + typed JSON. Formatted report / multiple tables →
        // one cell-address map (json_cells), built from native worksheet cells.
        const meta = detectContentMeta(csv);
        if (meta.contentType === "json_cells") {
          const { cells, rowCount } = worksheetToCellMap(ws);
          const json = JSON.stringify(cells);
          await loadUserData(databaseId, entryName, json, sourceFilename, {
            contentType: "json_cells",
            contentJson: json,
            rowCount,
          });
        } else {
          await loadUserData(databaseId, entryName, csv, sourceFilename);
        }
      }
    } else {
      const content = await (file as File).text();
      // QBO report text → parse to a normalized CSV table (`<name>_qbo_<kind>`).
      if (content.length <= 1_000_000) {
        const d = detectQboFromContent(content);
        if (d) {
          const report = parseQboReport(d.kind, d.cells, sourceFilename);
          const qboName = `${name}_qbo_${qboEntrySuffix(d.kind)}`;
          await loadUserData(
            databaseId,
            qboName,
            qboReportToCsv(d.kind, report),
            sourceFilename,
          );
          recognized.push({ label: d.label, entryName: qboName });
        } else {
          await loadUserData(databaseId, name, content, sourceFilename);
        }
      } else {
        await loadUserData(databaseId, name, content, sourceFilename);
      }
    }
  } catch (err) {
    console.error("[userDataLoadHandler] Failed to load data:", err);
    return c.text(
      err instanceof Error ? err.message : "Failed to load file — it may be too large or malformed.",
      400,
    );
  }

  logActivity(user.userEmail, "data_upload", name, user.userId);
  c.header("HX-Trigger", "workspaceChanged");
  if (recognized.length > 0) {
    return c.html(
      <span class="text-sm text-leaf-600">
        {recognized.length === 1
          ? `Recognized QuickBooks ${recognized[0].label} — saved as "${recognized[0].entryName}".`
          : `Recognized ${recognized.length} QuickBooks reports: ${recognized
              .map((r) => `"${r.entryName}" (${r.label})`)
              .join(", ")}.`}
      </span>,
    );
  }
  return c.text("", 200);
};

// ── GET /workspace/data/:name/download ───────────────────────────────────────

export const userDataDownloadHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const name = decodeURIComponent(c.req.param("name"));
  const content = await getUserData(databaseId, name);
  if (content === null) return c.text("Not found", 404);

  // Try to use the original source filename, fall back to name.txt
  const items = await listUserData(databaseId);
  const item = items.find((i) => i.name === name);
  const filename = item?.source_filename || `${name}.txt`;

  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(content);
};

// ── DELETE /workspace/data/:name ─────────────────────────────────────────────

export const userDataDeleteHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const name = decodeURIComponent(c.req.param("name"));
  await deleteUserData(databaseId, name);
  logActivity(user.userEmail, "data_delete", name, user.userId);

  c.header("HX-Trigger", "workspaceChanged");
  return c.text("OK", 200);
};

// ── GET /workspace/data/:name/content ─────────────────────────────────────
// Returns raw content as JSON for the edit modal.

export const userDataContentHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.json({ error: "No active database" }, 400);

  const name = decodeURIComponent(c.req.param("name"));
  const content = await getUserData(databaseId, name);
  if (content === null) return c.json({ error: "Not found" }, 404);

  return c.json({ name, content });
};

// ── PUT /workspace/data/:name ────────────────────────────────────────────
// Save edited content — goes through the same path as load/paste (re-detects, updates loaded_at).

export const userDataUpdateHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return c.text("No active database", 400);

  const name = decodeURIComponent(c.req.param("name"));

  // Check entry exists
  const existing = await getUserData(databaseId, name);
  if (existing === null) return c.text("Not found", 404);

  const body = await c.req.parseBody();
  const content = (body.content as string) ?? "";

  try {
    // Use loadUserData (same as paste/data-load) — re-detects metadata, updates loaded_at
    await loadUserData(databaseId, name, content);
  } catch (err) {
    console.error("[userDataUpdateHandler] Failed to save data:", err);
    return c.text(
      err instanceof Error ? err.message : "Failed to save data — it may be too large or malformed.",
      400,
    );
  }
  logActivity(user.userEmail, "data_edit", name, user.userId);

  c.header("HX-Trigger", "workspaceChanged");
  return c.text("OK", 200);
};
