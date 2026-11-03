import { Context } from "hono";
import { getSessionByDatabaseId } from "@backend/core/workspace/workspaceSessionStore";
import type { User } from "@backend/types";
import { buildWorkbook } from "@shared/wfp-api/xlsx";
import { listTabularEntries, resolveWorkbookSheets, workbookGrid } from "@data/workbookSheets";

/**
 * Standalone workbook builder — a chrome-free page (new browser tab) that lists
 * the workspace's tabular data entries as checkboxes, renders the checked items
 * as a read-only jspreadsheet (one worksheet per item), and downloads the
 * selection as a real .xlsx built server-side.
 *
 * Routes (all auth-gated + scoped to the open workspace via user.currentDatabaseId):
 *   GET  /sessions/workbook-builder            — the builder page
 *   GET  /sessions/workbook-builder/data       — JSON grid for the selected names
 *   POST /sessions/workbook-builder/download   — .xlsx of the selected names
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function resolveWorkspace(c: Context) {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) return null;
  const ws = getSessionByDatabaseId(databaseId);
  if (!ws) return null;
  ws.markActive();
  return ws;
}

export const workbookBuilderHandler = async (c: Context) => {
  const ws = resolveWorkspace(c);
  if (!ws) return c.text("No open workspace", 404);

  const entries = listTabularEntries(ws);
  return c.html(renderBuilderPage(entries));
};

export const workbookBuilderDataHandler = async (c: Context) => {
  const ws = resolveWorkspace(c);
  if (!ws) return c.text("No open workspace", 404);

  const names = splitNames(c.req.query("names") || "");
  const sheets = resolveWorkbookSheets(ws, names);
  return c.json({ sheets: workbookGrid(sheets) });
};

export const workbookBuilderDownloadHandler = async (c: Context) => {
  const ws = resolveWorkspace(c);
  if (!ws) return c.text("No open workspace", 404);

  const body = await c.req.parseBody();
  const names = splitNames(typeof body.names === "string" ? body.names : "");
  if (names.length === 0) return c.text("No data items selected", 400);

  const sheets = resolveWorkbookSheets(ws, names);
  if (sheets.length === 0) return c.text("No tabular data found for the selection", 400);

  const buf = buildWorkbook(sheets);
  const filename = "workbook.xlsx";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};

function splitNames(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Entry {
  name: string;
  columns: string[];
  rowCount: number;
}

function renderBuilderPage(entries: Entry[]): string {
  const items = entries
    .map((e) => {
      const cols = e.columns.length;
      const meta = `${e.rowCount.toLocaleString()} rows${cols ? ` · ${cols} columns` : ""}`;
      return `<label class="item">
        <input type="checkbox" class="item-cb" value="${esc(e.name)}">
        <span class="item-name">${esc(e.name)}</span>
        <span class="item-meta">${esc(meta)}</span>
      </label>`;
    })
    .join("\n");

  const empty = entries.length === 0
    ? `<p class="empty">No tabular data in this workspace yet. Load a CSV or Excel file on the Data page first.</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workbook builder</title>
<link rel="stylesheet" href="/public/vendor/jspreadsheet/jspreadsheet.min.css">
<link rel="stylesheet" href="/public/vendor/jsuites/jsuites.min.css">
<style>
:root{--line:#d9d9d9;--ink:#1f1f1f;--muted:#6b7280;--accent:#2563eb;--bg:#fafafa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:10}
header h1{margin:0;font-size:16px;font-weight:600}
header .meta{color:var(--muted);font-size:12px}
header .actions{margin-left:auto;display:flex;gap:8px}
button{font:inherit;font-weight:600;font-size:13px;padding:8px 16px;border-radius:8px;cursor:pointer;border:2px solid var(--accent)}
#build{background:var(--accent);color:#fff;border-color:var(--accent)}
#download{background:#fff;color:var(--accent);border-color:var(--accent)}
#build:disabled,#download:disabled{opacity:.5;cursor:not-allowed}
main{display:grid;grid-template-columns:280px 1fr;gap:0;min-height:calc(100vh - 58px)}
.checklist{border-right:1px solid var(--line);background:#fff;padding:12px;overflow-y:auto}
.checklist h2{margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer}
.item:hover{background:var(--bg)}
.item-cb{margin-top:3px}
.item-name{font-size:13px;word-break:break-word}
.item-meta{display:block;font-size:11px;color:var(--muted)}
.empty{color:var(--muted);font-size:13px}
.stage{display:flex;flex-direction:column;min-width:0}
#spreadsheet{flex:1;overflow:auto;padding:12px}
.hint{color:var(--muted);font-size:13px;padding:24px;text-align:center}
</style>
</head>
<body>
<header>
  <h1>Workbook builder</h1>
  <span class="meta">${entries.length} data item${entries.length === 1 ? "" : "s"}</span>
  <div class="actions">
    <button type="button" id="build">Build spreadsheet</button>
    <button type="button" id="download">Download .xlsx</button>
  </div>
</header>
<main>
  <section class="checklist">
    <h2>Data items (→ tabs)</h2>
    ${items}
    ${empty}
  </section>
  <section class="stage">
    <div id="spreadsheet"><div class="hint">Select data items on the left, then click <strong>Build spreadsheet</strong>.</div></div>
  </section>
</main>
<form id="dlform" method="post" action="/sessions/workbook-builder/download">
  <input type="hidden" name="names" id="dl-names" value="">
</form>
<script src="/public/vendor/jspreadsheet/jspreadsheet.min.js"></script>
<script src="/public/vendor/jsuites/jsuites.min.js"></script>
<script>
(function(){
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.item-cb'));
  var mount = document.getElementById('spreadsheet');
  var built = false;

  function preselectFromUrl(){
    var m = /[?&]names=([^&]+)/.exec(window.location.search);
    if (!m) return;
    var wanted = {};
    decodeURIComponent(m[1]).split(',').forEach(function(n){ wanted[n.trim()] = true; });
    boxes.forEach(function(b){ if (wanted[b.value]) b.checked = true; });
  }
  preselectFromUrl();

  function selected(){
    return boxes.filter(function(b){ return b.checked; }).map(function(b){ return b.value; });
  }

  function requireSelection(){
    var names = selected();
    if (!names.length){ alert('Select at least one data item first.'); return null; }
    return names;
  }

  document.getElementById('build').addEventListener('click', function(){
    var names = requireSelection();
    if (!names) return;
    fetch('/sessions/workbook-builder/data?names=' + encodeURIComponent(names.join(',')))
      .then(function(r){ if(!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); })
      .then(function(payload){
        var sheets = payload.sheets || [];
        if (built){ jspreadsheet.destroy(mount); mount.innerHTML = ''; }
        built = true;
        jspreadsheet(mount, {
          tabs: true,
          onbeforecreateworksheet: function(){ return false; },
          worksheets: sheets.map(function(s){
            return {
              data: s.rows || [],
              columns: (s.columns || []).map(function(col){ return { title: col, readOnly: true }; }),
              worksheetName: s.name
            };
          })
        });
      })
      .catch(function(err){ alert('Failed to load data: ' + err.message); });
  });

  document.getElementById('download').addEventListener('click', function(){
    var names = requireSelection();
    if (!names) return;
    document.getElementById('dl-names').value = names.join(',');
    document.getElementById('dlform').submit();
  });
})();
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
