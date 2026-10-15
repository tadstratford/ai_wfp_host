// Shared data-grid editor — Grid/Raw tabs over tabular data (CSV or a JSON
// array of objects). Used by the Data section edit modal and (next slice) the
// Accounting Inputs forms, so editing behaves the same everywhere.
//
// Per docs/CONVENTIONS.md: this component renders MARKUP ONLY. All client
// behavior lives in public/js/dataGrid.js (no JS shipped through JSX, no HTML
// built from strings). The JS finds elements by id, namespaced with `prefix`,
// so multiple grids can coexist on one page.

const TH_CLS =
  "px-2 py-1.5 text-left text-xs font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.03] dark:bg-white/[0.04] border border-ink/[0.08] dark:border-white/[0.08] whitespace-nowrap";
const TD_CLS =
  "px-2 py-1.5 border border-ink/[0.08] dark:border-white/[0.08] text-ink dark:text-white bg-white dark:bg-ink-900 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:bg-brand-50 dark:focus:bg-brand-900/30 whitespace-nowrap";
const TAB_BASE = "px-3 py-1.5 text-xs font-medium rounded-t-lg";
const TAB_ACTIVE = `${TAB_BASE} bg-white dark:bg-ink-800 text-brand-600 dark:text-brand-300 border border-b-0 border-ink/[0.08] dark:border-white/[0.08]`;
const TAB_INACTIVE = `${TAB_BASE} text-ink-500 dark:text-white/70 hover:text-ink-700`;
const ADD_BTN_CLS =
  "px-3 py-1 text-xs text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200 border border-dashed border-brand-300 dark:border-brand-700 rounded-md hover:bg-brand-50 dark:hover:bg-brand-900/30 transition-colors";

export interface GridData {
  headers: string[];
  rows: string[][];
}

export interface ParsedGrid {
  /** null when the content isn't tabular → the grid renders raw-only. */
  grid: GridData | null;
  /** serialization target when the grid is edited. */
  format: "csv" | "json";
}

export interface DataGridProps {
  /** id namespace so multiple grids can coexist on a page. Default "data". */
  prefix?: string;
  /** name attr of the raw textarea (what the surrounding form submits). Default "content". */
  rawName?: string;
  /** the full raw text (source of truth on submit). */
  rawContent: string;
  /** parsed tabular view, or null for raw-only content. */
  grid: GridData | null;
  /** how the grid serializes back to the textarea. Default "csv". */
  format?: "csv" | "json";
}

/**
 * Detect whether content is a JSON array of objects or CSV, and return a
 * tabular projection for the grid. Returns `grid: null` when the content isn't
 * tabular (plain text, a JSON scalar, etc.) so the caller shows raw-only.
 */
export function parseForGrid(content: string): ParsedGrid {
  const trimmed = content.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (
        Array.isArray(arr) &&
        arr.length > 0 &&
        arr.every((r) => r && typeof r === "object" && !Array.isArray(r))
      ) {
        const headers: string[] = [];
        for (const obj of arr) {
          for (const k of Object.keys(obj as Record<string, unknown>)) {
            if (!headers.includes(k)) headers.push(k);
          }
        }
        const rows = (arr as Record<string, unknown>[]).map((obj) =>
          headers.map((h) => {
            const v = obj[h];
            if (v === undefined || v === null) return "";
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          }),
        );
        return { grid: { headers, rows }, format: "json" };
      }
    } catch {
      /* not valid JSON — fall through to CSV */
    }
  }
  return { grid: parseCSVForGrid(content), format: "csv" };
}

/** Parse CSV content into headers + rows. Returns null if it isn't a table
 *  (needs a header row of ≥2 columns and ≥1 data row). */
export function parseCSVForGrid(content: string): GridData | null {
  const lines = content.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;

  const headers = parseCSVRow(lines[0]);
  if (headers.length < 2) return null;

  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    while (row.length < headers.length) row.push("");
    if (row.length > headers.length) row.length = headers.length;
    rows.push(row);
  }
  if (rows.length === 0) return null;
  return { headers, rows };
}

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
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
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** A column header cell: editable name + delete-column button. */
function HeaderCell({ name }: { name: string }) {
  return (
    <th class={TH_CLS}>
      <div class="flex items-center gap-1">
        <span
          contentEditable={true}
          class="grid-col-name outline-none focus:ring-1 focus:ring-brand-500 rounded px-1"
        >
          {name}
        </span>
        <button
          type="button"
          onclick="deleteGridColumn(this)"
          title="Delete column"
          class="text-ink-300 hover:text-coral-500 text-sm leading-none"
        >
          ×
        </button>
      </div>
    </th>
  );
}

/**
 * The shared grid editor. Renders Grid/Raw tabs (Grid hidden when the content
 * isn't tabular), an editable table with add/delete row & column controls, and
 * a raw textarea. The raw textarea is always present and carries `rawName`, so
 * the surrounding form submits whatever the grid was serialized into.
 */
export function DataGrid({
  prefix = "data",
  rawName = "content",
  rawContent,
  grid,
  format = "csv",
}: DataGridProps) {
  const hasGrid = grid !== null;
  return (
    <div
      data-grid-prefix={prefix}
      class="flex flex-col flex-1 min-h-0"
    >
      {hasGrid && (
        <div class="flex gap-1">
          <button
            type="button"
            id={`${prefix}-tab-grid`}
            onclick={`switchDataTab('grid','${prefix}')`}
            class={TAB_ACTIVE}
          >
            Grid
          </button>
          <button
            type="button"
            id={`${prefix}-tab-raw`}
            onclick={`switchDataTab('raw','${prefix}')`}
            class={TAB_INACTIVE}
          >
            Raw
          </button>
        </div>
      )}

      {hasGrid && (
        <div id={`${prefix}-view-grid`} class="flex-1 min-h-0 overflow-auto py-2">
          <table
            id={`${prefix}-grid`}
            data-format={format}
            class="w-full text-sm border-collapse"
          >
            <thead>
              <tr>
                {grid!.headers.map((h) => (
                  <HeaderCell name={h} />
                ))}
                <th class={`${TH_CLS} grid-actions w-8`}></th>
              </tr>
            </thead>
            <tbody>
              {grid!.rows.map((row) => (
                <tr>
                  {row.map((cell) => (
                    <td contentEditable={true} class={TD_CLS}>
                      {cell}
                    </td>
                  ))}
                  <td class={`${TD_CLS} grid-actions text-center`}>
                    <button
                      type="button"
                      onclick="deleteGridRow(this)"
                      title="Delete row"
                      class="text-ink-300 hover:text-coral-500"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="flex gap-2 mt-2">
            <button type="button" onclick={`addGridRow('${prefix}')`} class={ADD_BTN_CLS}>
              + Add Row
            </button>
            <button type="button" onclick={`addGridColumn('${prefix}')`} class={ADD_BTN_CLS}>
              + Add Column
            </button>
          </div>
        </div>
      )}

      {/* Raw view — always present so the form has a `name` to submit. */}
      <div id={`${prefix}-view-raw`} class={`flex-1 min-h-0 ${hasGrid ? "hidden" : ""}`}>
        <textarea
          id={`${prefix}-raw`}
          name={rawName}
          class="w-full h-full px-3 py-2 text-sm border border-ink/[0.12] dark:border-white/[0.1] rounded-xl bg-[#F3F5F9] dark:bg-ink-800 text-ink dark:text-white focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 font-mono resize-none"
          style="min-height: 400px"
        >
          {rawContent}
        </textarea>
      </div>
    </div>
  );
}
