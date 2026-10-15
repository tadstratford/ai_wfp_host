// Data Grid — Grid/Raw editing for the shared <DataGrid> component.
//
// Conventions (docs/CONVENTIONS.md): all grid DOM is built here with the DOM
// API (createElement / textContent) — never HTML strings — so nothing
// dangerous is ever injected. Elements are addressed by id, namespaced with a
// `prefix` ("data" by default) so several grids can live on one page.
//
// A grid serializes back to its source format, read from the table's
// `data-format` attribute ("csv" | "json"). The raw textarea (`<prefix>-raw`)
// is the source of truth on submit.

// Tailwind classes kept in sync with frontend/components/dataGrid.tsx.
var DG_TH_CLS =
  "px-2 py-1.5 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 whitespace-nowrap";
var DG_TD_CLS =
  "px-2 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-blue-50 dark:focus:bg-blue-950/30 whitespace-nowrap";
var DG_TAB_BASE = "px-3 py-1.5 text-xs font-medium rounded-t-lg";
var DG_TAB_ACTIVE =
  DG_TAB_BASE +
  " bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 border border-b-0 border-gray-200 dark:border-gray-700";
var DG_TAB_INACTIVE = DG_TAB_BASE + " text-gray-500 dark:text-gray-400 hover:text-gray-700";

function dgEl(prefix, suffix) {
  return document.getElementById((prefix || "data") + "-" + suffix);
}

// ── Tab switching ────────────────────────────────────────────────────────────

function switchDataTab(tab, prefix) {
  prefix = prefix || "data";
  var gridView = dgEl(prefix, "view-grid");
  var rawView = dgEl(prefix, "view-raw");
  var tabGrid = dgEl(prefix, "tab-grid");
  var tabRaw = dgEl(prefix, "tab-raw");
  if (!gridView || !rawView) return;

  if (tab === "grid") {
    // Raw is the source of truth → rebuild the grid from it.
    rebuildGridFromRaw(prefix);
    gridView.classList.remove("hidden");
    rawView.classList.add("hidden");
    if (tabGrid) tabGrid.className = DG_TAB_ACTIVE;
    if (tabRaw) tabRaw.className = DG_TAB_INACTIVE;
  } else {
    // Grid is the source of truth → serialize it into the textarea.
    syncGridToTextarea(prefix);
    rawView.classList.remove("hidden");
    gridView.classList.add("hidden");
    if (tabRaw) tabRaw.className = DG_TAB_ACTIVE;
    if (tabGrid) tabGrid.className = DG_TAB_INACTIVE;
  }
}

// ── Grid → textarea (serialize) ──────────────────────────────────────────────

// Serialize the grid back to the textarea in its source format. Called before
// switching to the raw tab and before the form submits. No-op when the raw tab
// is already visible (the textarea already holds the user's edits).
function syncGridToTextarea(prefix) {
  prefix = prefix || "data";
  var table = dgEl(prefix, "grid");
  var raw = dgEl(prefix, "raw");
  if (!raw || !table) return;

  var gridView = dgEl(prefix, "view-grid");
  if (gridView && gridView.classList.contains("hidden")) return;

  var headers = dgHeaders(table);
  var rows = dgRows(table);
  var format = table.getAttribute("data-format") || "csv";
  raw.value = format === "json" ? dgToJson(headers, rows) : dgToCsv(headers, rows);
}

function dgHeaders(table) {
  var headers = [];
  table.querySelectorAll("thead th").forEach(function (th) {
    if (th.classList.contains("grid-actions")) return;
    var span = th.querySelector(".grid-col-name");
    headers.push(((span ? span.textContent : th.textContent) || "").trim());
  });
  return headers;
}

function dgRows(table) {
  var rows = [];
  table.querySelectorAll("tbody tr").forEach(function (tr) {
    var cells = [];
    tr.querySelectorAll("td").forEach(function (td) {
      if (td.classList.contains("grid-actions")) return;
      cells.push(td.textContent || "");
    });
    rows.push(cells);
  });
  return rows;
}

function dgToCsv(headers, rows) {
  var lines = [headers.map(csvEscape).join(",")];
  rows.forEach(function (r) {
    lines.push(r.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

function dgToJson(headers, rows) {
  var arr = rows.map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) {
      obj[h] = dgCoerce(r[i] == null ? "" : r[i]);
    });
    return obj;
  });
  return JSON.stringify(arr, null, 2);
}

// Coerce a cell string back to a JSON scalar. Conservative on purpose: leading
// zeros (account codes like "0100") and anything non-canonical stay strings,
// so accounting identifiers are never silently mangled into numbers.
function dgCoerce(s) {
  s = String(s);
  var t = s.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) {
    var n = Number(t);
    if (!isNaN(n) && isFinite(n)) return n;
  }
  return s;
}

function csvEscape(value) {
  value = String(value == null ? "" : value);
  if (value.indexOf(",") >= 0 || value.indexOf('"') >= 0 || value.indexOf("\n") >= 0) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ── textarea → grid (parse + rebuild) ────────────────────────────────────────

function rebuildGridFromRaw(prefix) {
  prefix = prefix || "data";
  var raw = dgEl(prefix, "raw");
  var table = dgEl(prefix, "grid");
  if (!raw || !table) return;

  var format = table.getAttribute("data-format") || "csv";
  var parsed = format === "json" ? dgParseJson(raw.value) : dgParseCsv(raw.value);
  if (!parsed) return; // leave the existing grid if the raw text no longer parses
  dgRenderGrid(table, parsed.headers, parsed.rows);
}

function dgParseCsv(text) {
  var lines = text.split("\n").filter(function (l) {
    return l.trim();
  });
  if (lines.length < 1) return null;
  var headers = parseCSVRow(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var r = parseCSVRow(lines[i]);
    while (r.length < headers.length) r.push("");
    if (r.length > headers.length) r.length = headers.length;
    rows.push(r);
  }
  return { headers: headers, rows: rows };
}

function dgParseJson(text) {
  try {
    var arr = JSON.parse(text);
    if (!Array.isArray(arr)) return null;
    var headers = [];
    arr.forEach(function (o) {
      if (o && typeof o === "object") {
        Object.keys(o).forEach(function (k) {
          if (headers.indexOf(k) < 0) headers.push(k);
        });
      }
    });
    var rows = arr.map(function (o) {
      return headers.map(function (h) {
        var v = o && typeof o === "object" ? o[h] : undefined;
        if (v === undefined || v === null) return "";
        return typeof v === "object" ? JSON.stringify(v) : String(v);
      });
    });
    return { headers: headers, rows: rows };
  } catch (e) {
    return null;
  }
}

function parseCSVRow(line) {
  var fields = [];
  var current = "";
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ── DOM builders (DOM API only — no HTML strings) ────────────────────────────

function dgMakeHeaderCell(name) {
  var th = document.createElement("th");
  th.className = DG_TH_CLS;
  var wrap = document.createElement("div");
  wrap.className = "flex items-center gap-1";
  var span = document.createElement("span");
  span.contentEditable = "true";
  span.className = "grid-col-name outline-none focus:ring-1 focus:ring-blue-500 rounded px-1";
  span.textContent = name;

  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "×";
  btn.title = "Delete column";
  btn.className = "text-gray-300 hover:text-red-500 text-sm leading-none";
  btn.setAttribute("onclick", "deleteGridColumn(this)");

  wrap.appendChild(span);
  wrap.appendChild(btn);
  th.appendChild(wrap);
  return th;
}

function dgMakeActionsHeader() {
  var th = document.createElement("th");
  th.className = DG_TH_CLS + " grid-actions w-8";
  return th;
}

function dgMakeDataCell(value) {
  var td = document.createElement("td");
  td.contentEditable = "true";
  td.className = DG_TD_CLS;
  td.textContent = value || "";
  return td;
}

function dgMakeRowActionsCell() {
  var td = document.createElement("td");
  td.className = DG_TD_CLS + " grid-actions text-center";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "×";
  btn.title = "Delete row";
  btn.className = "text-gray-300 hover:text-red-500";
  btn.setAttribute("onclick", "deleteGridRow(this)");
  td.appendChild(btn);
  return td;
}

function dgRenderGrid(table, headers, rows) {
  var thead = table.querySelector("thead");
  var tbody = table.querySelector("tbody");
  if (!thead || !tbody) return;

  thead.innerHTML = "";
  var htr = document.createElement("tr");
  headers.forEach(function (h) {
    htr.appendChild(dgMakeHeaderCell(h));
  });
  htr.appendChild(dgMakeActionsHeader());
  thead.appendChild(htr);

  tbody.innerHTML = "";
  rows.forEach(function (r) {
    var tr = document.createElement("tr");
    for (var c = 0; c < headers.length; c++) tr.appendChild(dgMakeDataCell(r[c] || ""));
    tr.appendChild(dgMakeRowActionsCell());
    tbody.appendChild(tr);
  });
}

// ── Row / column actions ─────────────────────────────────────────────────────

function addGridRow(prefix) {
  prefix = prefix || "data";
  var table = dgEl(prefix, "grid");
  if (!table) return;
  var colCount = table.querySelectorAll("thead th:not(.grid-actions)").length;
  if (colCount === 0) return;
  var tbody = table.querySelector("tbody");
  if (!tbody) return;
  var tr = document.createElement("tr");
  for (var c = 0; c < colCount; c++) tr.appendChild(dgMakeDataCell(""));
  tr.appendChild(dgMakeRowActionsCell());
  tbody.appendChild(tr);
  var first = tr.querySelector("td");
  if (first) first.focus();
}

function addGridColumn(prefix) {
  prefix = prefix || "data";
  var table = dgEl(prefix, "grid");
  if (!table) return;
  var headerTr = table.querySelector("thead tr");
  if (!headerTr) return;
  var actionsTh = headerTr.querySelector("th.grid-actions");
  var count = headerTr.querySelectorAll("th:not(.grid-actions)").length;
  headerTr.insertBefore(dgMakeHeaderCell("Column " + (count + 1)), actionsTh);
  table.querySelectorAll("tbody tr").forEach(function (tr) {
    var actionsTd = tr.querySelector("td.grid-actions");
    tr.insertBefore(dgMakeDataCell(""), actionsTd);
  });
}

function deleteGridRow(btn) {
  var tr = btn.closest("tr");
  if (tr) tr.parentNode.removeChild(tr);
}

function deleteGridColumn(btn) {
  var th = btn.closest("th");
  var table = btn.closest("table");
  if (!th || !table) return;
  var idx = th.cellIndex;
  th.parentNode.removeChild(th);
  table.querySelectorAll("tbody tr").forEach(function (tr) {
    if (tr.cells[idx]) tr.removeChild(tr.cells[idx]);
  });
}
