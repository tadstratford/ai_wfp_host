import { Context } from "hono";
import type { User } from "@backend/types";
import { listUserData, loadUserData, getUserData } from "@backend/core/user-data/index";
import { clearAllUserData } from "@backend/core/user-data/index";
import { refreshActiveWorkspaceIfStale } from "@backend/core/workspace/workspaceLifecycle";
import { loadPrivacyMap } from "@backend/core/knowledge/index";
import { buildTextMasker } from "@backend/core/knowledge/autoMask";
import { detectQboFromContent } from "@data/qbo/ingest";
import { parseQboReport, qboReportToCsv, qboEntrySuffix } from "@data/qbo/toTable";
import { DataGrid, parseForGrid } from "@frontend/components/dataGrid";

/**
 * Data panel — shows data entries + upload form.
 * Rendered as HTMX partial into #main-panel.
 */
export const dataPanelView = async (c: Context) => {
  const user = c.get("user") as User;
  if (!user.currentDatabaseId) {
    return c.html(<div class="p-8 text-ink-400">No database</div>);
  }

  // Re-hydrate from Supabase if another machine/instance saved since we last
  // synced (cheap metadata check; no-op when timestamps match).
  try {
    await refreshActiveWorkspaceIfStale(user.currentDatabaseId);
  } catch (err) {
    console.error("[dataPanelView] freshness check failed:", err);
  }

  const items = await listUserData(user.currentDatabaseId);

  return c.html(
    <div class="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
      <div class="flex items-start justify-between gap-4 mb-2">
        <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">
          Data
        </h1>
        <label class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-3 py-1.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors flex items-center gap-2 cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 9h10v10H9zM5 5h10v3M5 5v10h3" />
          </svg>
          Copy Data
          <input
            type="file"
            name="file"
            accept=".wfp,application/json"
            class="hidden"
            hx-post="/app/copy-from-file/upload"
            hx-vals='{"kind":"data"}'
            hx-encoding="multipart/form-data"
            hx-trigger="change"
            hx-target="#modal-container"
            hx-swap="innerHTML"
          />
        </label>
      </div>
      <p class="text-sm text-ink-500 mb-6">
        Load, paste, and manage the data your workflows run on. Excel workbooks are
        auto-detected and each sheet becomes its own data object. QuickBooks
        reports (General Ledger, Journal, Chart of Accounts) are recognized and
        parsed into normalized tables named <code class="text-xs">*_qbo_*</code>.
        Your data is stored in your workspace and never on our servers.
      </p>

      {/* View switcher — three focused views */}
      <div class="flex flex-wrap gap-2 mb-6">
        <button
          type="button"
          data-tabbtn="data"
          data-tabkey="list"
          onclick="wfpShowBadgeTab('data','list')"
          class="px-4 py-1.5 text-sm font-semibold rounded-full border transition-colors bg-brand-500 text-white border-brand-500"
        >
          Data List
        </button>
        <button
          type="button"
          data-tabbtn="data"
          data-tabkey="load"
          onclick="wfpShowBadgeTab('data','load')"
          class="px-4 py-1.5 text-sm font-semibold rounded-full border transition-colors bg-white text-ink-600 border-ink/[0.1] hover:bg-ink/[0.04] dark:bg-ink-800 dark:text-white/80 dark:border-white/[0.1]"
        >
          Load Data
        </button>
        <button
          type="button"
          data-tabbtn="data"
          data-tabkey="paste"
          onclick="wfpShowBadgeTab('data','paste')"
          class="px-4 py-1.5 text-sm font-semibold rounded-full border transition-colors bg-white text-ink-600 border-ink/[0.1] hover:bg-ink/[0.04] dark:bg-ink-800 dark:text-white/80 dark:border-white/[0.1]"
        >
          Paste Data
        </button>
      </div>

      {/* Data List view */}
      <div data-tabpanel="data" data-tabkey="list">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-bold uppercase tracking-wider text-ink-500">
            Loaded Files
          </h2>
          {items.length > 0 && (
            <button
              hx-post="/app/clear-data"
              hx-confirm="Clear all data?"
              hx-swap="none"
              hx-on--after-request="htmx.ajax('GET', '/app/data/list', {target: '#data-file-list', swap: 'innerHTML'})"
              class="text-xs text-coral-500 hover:text-coral-600 dark:text-coral-400 dark:hover:text-coral-300"
            >
              Clear All
            </button>
          )}
        </div>
        <div id="data-file-list">
          <DataFileList items={items} />
        </div>
      </div>

      {/* Load Data view */}
      <div data-tabpanel="data" data-tabkey="load" class="hidden">
        <div class="card p-5">
          <h2 class="text-sm font-bold text-ink dark:text-white mb-1">Load Data</h2>
          <p class="text-xs text-ink-500 mb-4">
            Upload CSV, JSON, text, or an Excel workbook. Excel files are auto-detected —
            each sheet becomes its own data object. QuickBooks General Ledger, Journal, and
            Chart of Accounts exports are parsed into normalized tables.
          </p>
          <form
            hx-post="/app/workspace/api/data/load"
            hx-target="#load-result"
            hx-swap="innerHTML"
            hx-encoding="multipart/form-data"
            hx-on--after-request="if(event.detail.successful) { this.reset(); wfpShowBadgeTab('data','list'); htmx.ajax('GET', '/app/data/list', {target: '#data-file-list', swap: 'innerHTML'}) }"
            class="flex flex-col gap-3"
          >
            <input
              type="text"
              name="name"
              placeholder="Data name (e.g. bank_transactions, open_invoices)"
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition"
            />
            <input
              type="file"
              name="file"
              accept=".csv,.txt,.json,.tsv,.xlsx,.xls,.xlsm"
              class="w-full text-sm text-ink-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 dark:file:bg-brand-900/40 dark:file:text-brand-300"
              required
              onchange={`const f=this.files[0].name; const dot=f.lastIndexOf('.'); const base=dot>0?f.slice(0,dot):f; const n=this.form.querySelector('[name=name]'); if(n&&!n.value){ n.value=base.toLowerCase().replace(/[^a-z0-9_]/g,'_'); }`}
            />
            <p class="text-xs text-ink-400 -mt-1">
              Excel (.xlsx, .xls, .xlsm), CSV, Text, and JSON files
            </p>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <button
                  type="submit"
                  class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition"
                >
                  Upload
                </button>
                <span class="htmx-indicator inline-flex items-center gap-2 text-xs text-ink-400">
                  <span class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></span>
                  Loading...
                </span>
              </div>
              <span id="load-result"></span>
            </div>
          </form>
        </div>
      </div>

      {/* Paste Data view */}
      <div data-tabpanel="data" data-tabkey="paste" class="hidden">
        <div class="card p-5">
          <h2 class="text-sm font-bold text-ink dark:text-white mb-1">Paste Data</h2>
          <p class="text-xs text-ink-500 mb-4">
            Paste CSV, JSON, or plain text to create a data object. Pasting a
            QuickBooks General Ledger / Journal / Chart of Accounts export parses
            it into a normalized table.
          </p>
          <form
            hx-post="/app/data/paste"
            hx-target="#paste-result"
            hx-swap="innerHTML"
            hx-on--after-request="if(event.detail.successful) { this.reset(); wfpShowBadgeTab('data','list'); htmx.ajax('GET', '/app/data/list', {target: '#data-file-list', swap: 'innerHTML'}) }"
            class="flex flex-col gap-3"
          >
            <input
              type="text"
              name="name"
              placeholder="Data name (e.g. bank_transactions, open_invoices)"
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition"
              required
            />
            <textarea
              name="content"
              rows={6}
              placeholder="Paste CSV, JSON, or plain text here..."
              class="w-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white placeholder:text-ink-400 outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 transition font-mono overflow-y-auto"
              style="min-height:120px; max-height:400px"
              required
            />
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <button
                  type="submit"
                  class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition"
                >
                  Save
                </button>
                <span class="htmx-indicator inline-flex items-center gap-2 text-xs text-ink-400">
                  <span class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></span>
                  Saving...
                </span>
              </div>
              <div id="paste-result"></div>
            </div>
          </form>
        </div>
      </div>
    </div>,
  );
};

/** Render the list of data entries */
export const DataFileList = ({ items }: { items: any[] }) => {
  if (items.length === 0) {
    return (
      <p class="text-sm text-ink-400 dark:text-ink-500">
        No data loaded. Paste or upload a file above.
      </p>
    );
  }

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
        " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch { return iso; }
  };

  return (
    <div class="space-y-2">
      {items.map((item: any) => {
        const sizeKb = Math.round(item.size / 1024);
        const sizeLabel = sizeKb > 0 ? `${sizeKb} KB` : `${item.size} chars`;
        const timestamp = item.edited_at || item.loaded_at;

        return (
          <div
            key={item.name}
            class="flex items-center justify-between px-4 py-3 card rounded-xl"
          >
            <div class="min-w-0">
              <span class="block text-sm font-medium text-ink dark:text-white truncate">
                {item.name}
              </span>
              {item.content_type && (
                <span class="text-xs text-ink-400 ml-2 uppercase">{item.content_type}</span>
              )}
              {item.row_count != null && (
                <span class="text-xs text-ink-400 ml-1">{item.row_count} rows</span>
              )}
              <span class="text-xs text-ink-400 ml-1">({sizeLabel})</span>
              {timestamp && (
                <p class="text-xs text-ink-400 dark:text-ink-500 mt-0.5">
                  {item.edited_at ? "Updated" : "Loaded"} {formatDate(timestamp)}
                </p>
              )}
              {item.columns && (() => {
                try {
                  const cols = JSON.parse(item.columns);
                  return (
                    <p class="text-xs text-ink-400 mt-0.5 truncate max-w-md">
                      {cols.join(", ")}
                    </p>
                  );
                } catch { return null; }
              })()}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button
                hx-get={`/app/data/edit/${encodeURIComponent(item.name)}`}
                hx-target="#modal-container"
                hx-swap="innerHTML"
                hx-on--after-request="document.getElementById('modal-container').classList.remove('hidden')"
                class="text-xs text-brand-600 dark:text-brand-300 hover:underline"
              >
                Edit
              </button>
              <label class="text-xs text-brand-600 dark:text-brand-300 hover:underline cursor-pointer">
                Replace
                <input
                  type="file"
                  accept=".csv,.txt,.json,.tsv,.xlsx,.xls"
                  class="hidden"
                  onchange={`replaceUserData(this, '${item.name.replace(/'/g, "\\'")}')`}
                />
              </label>
              <a
                href={`/app/workspace/api/data/${encodeURIComponent(item.name)}/download`}
                class="text-xs text-brand-600 dark:text-brand-300 hover:underline"
              >
                Download
              </a>
              <button
                hx-delete={`/app/workspace/api/data/${encodeURIComponent(item.name)}`}
                hx-swap="none"
                hx-confirm={`Delete "${item.name}"?`}
                hx-on--after-request="htmx.ajax('GET', '/app/data/list', {target: '#data-file-list', swap: 'innerHTML'})"
                class="text-xs text-coral-500 hover:text-coral-600 dark:text-coral-400"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** POST /app/data/paste — save pasted data with auto-detection */
export const dataPasteHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<span class="text-sm text-coral-600">No workspace active.</span>);
  }

  const body = await c.req.parseBody();
  const name = ((body.name as string) || "").trim().replace(/\s+/g, "_").toLowerCase();
  const content = ((body.content as string) || "").trim();

  if (!name) {
    return c.html(<span class="text-sm text-coral-600">Please enter a name.</span>);
  }
  if (!content) {
    return c.html(<span class="text-sm text-coral-600">Please paste some data.</span>);
  }

  try {
    // QBO report paste → parse to a normalized CSV table (`<name>_qbo_<kind>`).
    if (content.length <= 1_000_000) {
      const d = detectQboFromContent(content);
      if (d) {
        const report = parseQboReport(d.kind, d.cells);
        const entryName = `${name}_qbo_${qboEntrySuffix(d.kind)}`;
        await loadUserData(databaseId, entryName, qboReportToCsv(d.kind, report));
        return c.html(
          <span class="text-sm text-leaf-600">Recognized QuickBooks {d.label} — saved as "{entryName}".</span>,
        );
      }
    }
    await loadUserData(databaseId, name, content);
    return c.html(
      <span class="text-sm text-leaf-600">Saved "{name}" — ready to use in workflows.</span>,
    );
  } catch (err: any) {
    return c.html(<span class="text-sm text-coral-600">Error: {err.message || String(err)}</span>);
  }
};

/** HTMX endpoint: refreshed file list after upload/delete */
export const dataFileListHandler = async (c: Context) => {
  const user = c.get("user") as User;
  if (!user.currentDatabaseId) {
    return c.html(<p class="text-sm text-ink-400">No database</p>);
  }

  const items = await listUserData(user.currentDatabaseId);
  return c.html(<DataFileList items={items} />);
};

/** GET /app/data/edit/:name — render edit modal with Grid/Raw tabs */
export const dataEditModalHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const databaseId = user.currentDatabaseId;
  if (!databaseId) {
    return c.html(<div class="p-4 text-coral-500">No workspace active.</div>);
  }

  const name = decodeURIComponent(c.req.param("name"));
  const content = await getUserData(databaseId, name);
  if (content === null) {
    return c.html(<div class="p-4 text-coral-500">Data "{name}" not found.</div>);
  }

  // Project the content into the shared grid (CSV or JSON array of objects).
  const { grid, format } = parseForGrid(content);
  const view = c.req.query("view") === "masked" ? "masked" : "edit";

  // Masked preview: a read-only projection where each cell value is swapped for
  // its privacy-map stand-in (real → fake). The raw data is never edited here.
  let maskedGrid: { headers: string[]; rows: string[][] } | null = null;
  if (view === "masked" && grid) {
    const masker = buildTextMasker(loadPrivacyMap(databaseId) ?? new Map<string, string>());
    maskedGrid = {
      headers: grid.headers,
      rows: grid.rows.map((row) => row.map((cell) => masker.mask(cell))),
    };
  }

  const toggleBase = "px-3 py-1.5 text-xs font-medium rounded-t-lg";
  const toggleActive = `${toggleBase} bg-white dark:bg-ink-800 text-brand-600 dark:text-brand-300 border border-b-0 border-ink/[0.08] dark:border-white/[0.08]`;
  const toggleInactive = `${toggleBase} text-ink-500 dark:text-white/70 hover:text-ink-700`;

  return c.html(
    <div
      id="edit-data-modal-backdrop"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div class="bg-white dark:bg-ink-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between px-5 py-4 border-b border-ink/[0.07] dark:border-white/[0.07]">
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white">
              Edit: {name}
            </h2>
            <div class="flex gap-1">
              <button
                type="button"
                hx-get={`/app/data/edit/${encodeURIComponent(name)}`}
                hx-target="#modal-container"
                hx-swap="innerHTML"
                hx-on--after-request="document.getElementById('modal-container').classList.remove('hidden')"
                class={view === "edit" ? toggleActive : toggleInactive}
              >
                Edit
              </button>
              <button
                type="button"
                hx-get={`/app/data/edit/${encodeURIComponent(name)}?view=masked`}
                hx-target="#modal-container"
                hx-swap="innerHTML"
                hx-on--after-request="document.getElementById('modal-container').classList.remove('hidden')"
                class={view === "masked" ? toggleActive : toggleInactive}
              >
                Masked
              </button>
            </div>
          </div>
          <button
            id="cancel-edit-data-modal"
            class="text-ink-400 hover:text-ink-600 dark:hover:text-white"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {view === "masked" ? (
          <div class="flex flex-col flex-1 min-h-0 px-5 py-3">
            <div class="mb-2 text-xs text-ink-500">
              Read-only masked preview — every value is swapped for a realistic stand-in
              before it would reach an AI. Switch back to <strong>Edit</strong> to change data.
            </div>
            {maskedGrid ? (
              <div class="flex-1 min-h-0 overflow-auto rounded-xl border border-ink/[0.08] dark:border-white/[0.08]">
                <table class="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {maskedGrid.headers.map((h) => (
                        <th class="px-2 py-1.5 text-left text-xs font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.03] dark:bg-white/[0.04] border border-ink/[0.08] dark:border-white/[0.08] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {maskedGrid.rows.map((row) => (
                      <tr>
                        {row.map((cell) => (
                          <td class="px-2 py-1.5 border border-ink/[0.08] dark:border-white/[0.08] text-ink dark:text-white bg-white dark:bg-ink-900 font-mono whitespace-nowrap">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p class="text-sm text-ink-400">This data has no columns to preview.</p>
            )}
          </div>
        ) : (
          <form
            id="edit-data-form"
            hx-put={`/app/workspace/api/data/${encodeURIComponent(name)}`}
            hx-swap="none"
            hx-on--before-request="if(typeof syncGridToTextarea==='function')syncGridToTextarea()"
            hx-on--after-request="if(event.detail.successful) { var mc = document.getElementById('modal-container'); if(mc) { mc.innerHTML=''; mc.classList.add('hidden'); } htmx.ajax('GET', '/app/data/list', {target: '#data-file-list', swap: 'innerHTML'}) }"
            class="flex flex-col flex-1 min-h-0"
          >
            {/* Shared grid/raw editor (frontend/components/dataGrid.tsx). */}
            <div class="flex flex-col flex-1 min-h-0 px-5 py-3">
              <DataGrid
                prefix="data"
                rawName="content"
                rawContent={content}
                grid={grid}
                format={format}
              />
            </div>

            <div class="flex items-center justify-end gap-3 px-5 py-4 border-t border-ink/[0.07] dark:border-white/[0.07]">
              <button
                type="button"
                id="cancel-edit-data-modal-btn"
                class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
  );
};
