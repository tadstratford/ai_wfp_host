import { Context } from "hono";
import { getSession } from "@backend/core/session/sessions/session_all";
import type { User } from "@backend/types";
import type { WorkbookSheetData } from "@core/tools/reportRenderer";

/**
 * Render a session message's workbook data in a standalone, chrome-free page
 * (new browser tab). Minimal spreadsheet layout: sheet tabs + a read-only grid
 * with a sticky header row and sticky first column. Self-contained — no app
 * shell, no Tailwind, no external JS.
 *
 * URL: /sessions/workbook?session_id=<uuid>&id=<message_id>
 */
export const workbookHandler = async (c: Context) => {
  const sessionId = c.req.query("session_id") || "";
  const messageId = c.req.query("id") || "";

  if (!sessionId || !messageId) {
    return c.text("Missing session_id or id query parameter", 400);
  }

  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  const session = await getSession(databaseId, sessionId);

  if (!session) {
    return c.text("Session not found", 404);
  }

  const message = session.messages.find(
    (m: any) => m.id === messageId || m.json?.messageId === messageId,
  );
  if (!message) {
    return c.text("Message not found", 404);
  }

  // Full data lives on `json.workbook.sheets` (all rows); fall back to the
  // capped `json.preview.sheets` for messages persisted before this field.
  const sheets: WorkbookSheetData[] =
    (message as any).json?.workbook?.sheets ?? (message as any).json?.preview?.sheets ?? [];

  if (!Array.isArray(sheets) || sheets.length === 0) {
    return c.text("This message has no workbook data", 404);
  }

  const title = sheets.length === 1 ? sheets[0].name : "Workbook";
  const totalRows = sheets.reduce((n, s) => n + (s.rows?.length ?? 0), 0);
  const totalCols = sheets[0]?.columns?.length ?? 0;

  return c.html(renderWorkbookPage(title, sheets, totalRows, totalCols));
};

function renderWorkbookPage(
  title: string,
  sheets: WorkbookSheetData[],
  totalRows: number,
  totalCols: number,
): string {
  const tabs = sheets
    .map(
      (s, i) =>
        `<button type="button" class="tab${i === 0 ? " active" : ""}" data-tab="${i}">${esc(s.name)}</button>`,
    )
    .join("");

  const panels = sheets
    .map((s, i) => renderSheet(s, i))
    .join("");

  const meta = `${sheets.length} sheet${sheets.length === 1 ? "" : "s"} · ${totalRows.toLocaleString()} rows · ${totalCols.toLocaleString()} columns`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--line:#d9d9d9;--head:#f3f3f3;--ink:#1f1f1f;--muted:#6b7280;--accent:#2563eb}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--line);background:#fafafa;position:sticky;top:0;z-index:10}
header h1{margin:0;font-size:15px;font-weight:600}
header .meta{color:var(--muted);font-size:12px}
.tabs{display:flex;gap:2px;padding:8px 16px 0;border-bottom:1px solid var(--line);background:#fafafa;overflow-x:auto}
.tab{border:1px solid var(--line);border-bottom:none;background:#fff;color:#333;padding:7px 14px;font:inherit;cursor:pointer;border-radius:6px 6px 0 0;white-space:nowrap}
.tab.active{background:#fff;border-bottom:1px solid #fff;margin-bottom:-1px;color:var(--accent);font-weight:600}
.sheet{display:none;overflow:auto;height:calc(100vh - 92px)}
.sheet.active{display:block}
table{border-collapse:separate;border-spacing:0;min-width:100%}
th,td{border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:5px 10px;white-space:nowrap;text-align:left}
thead th{position:sticky;top:0;z-index:2;background:var(--head);font-weight:600;text-align:left}
th.rowhead,td.rowhead{position:sticky;left:0;z-index:1;background:#fff;text-align:right;color:var(--muted);min-width:52px}
thead th.rowhead{z-index:3;background:var(--head)}
tbody td.num{text-align:right;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <span class="meta">${esc(meta)}</span>
</header>
${sheets.length > 1 ? `<nav class="tabs">${tabs}</nav>` : ""}
${panels}
<script>
(function(){
  var tabs=document.querySelectorAll('.tab');
  var panels=document.querySelectorAll('.sheet');
  function show(i){
    for(var k=0;k<tabs.length;k++){
      tabs[k].classList.toggle('active',Number(tabs[k].getAttribute('data-tab'))===i);
      panels[k].classList.toggle('active',k===i);
    }
  }
  tabs.forEach(function(t){t.addEventListener('click',function(){show(Number(t.getAttribute('data-tab')))})});
})();
</script>
</body>
</html>`;
}

function renderSheet(sheet: WorkbookSheetData, index: number): string {
  const cols = sheet.columns ?? [];
  const rows = sheet.rows ?? [];

  const head = cols
    .map((c) => `<th>${esc(c)}</th>`)
    .join("");

  const body = rows
    .map((row, r) => {
      const cells = row.map((cell) => {
        const isNum = typeof cell === "number";
        const cls = isNum ? ' class="num"' : "";
        return `<td${cls}>${cell === "" || cell === null || cell === undefined ? "\u00a0" : esc(String(cell))}</td>`;
      }).join("");
      return `<tr><td class="rowhead">${r + 1}</td>${cells}</tr>`;
    })
    .join("");

  return `<div class="sheet${index === 0 ? " active" : ""}" data-sheet="${index}">
  <table>
    <thead><tr><th class="rowhead">#</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
