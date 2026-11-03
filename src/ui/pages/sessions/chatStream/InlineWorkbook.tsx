/**
 * InlineWorkbook — a read-only spreadsheet preview rendered in the chat stream.
 *
 * Renders a download button (passed as prebuilt HTML), a tab bar (one tab per
 * sheet), and a scrollable read-only grid for the active sheet. Tab switching
 * reuses the `wfpShowTab(group, key)` contract from public/js/accountingTabs.js
 * (`data-tabbtn` / `data-tabpanel`); the first sheet is rendered active
 * server-side so first paint needs no JS.
 */

export interface WorkbookSheetView {
  name: string;
  columns: string[];
  rows: (string | number | boolean)[][];
  total: number;
}

const TH_CLS =
  "px-2 py-1.5 text-left text-xs font-semibold text-ink-600 dark:text-white/80 bg-ink/[0.03] dark:bg-white/[0.04] border border-ink/[0.08] dark:border-white/[0.08] whitespace-nowrap";
const TD_CLS =
  "px-2 py-1.5 border border-ink/[0.08] dark:border-white/[0.08] text-ink dark:text-white bg-white dark:bg-ink-900 whitespace-nowrap";

/** A single read-only grid: sticky header + horizontally scrollable body. */
function ReadOnlyGrid({ sheet }: { sheet: WorkbookSheetView }) {
  return (
    <div style="max-height:360px;overflow:auto;" class="rounded-lg border border-ink/[0.08] dark:border-white/[0.08]">
      <table class="w-full text-sm border-collapse">
        <thead style="position:sticky;top:0;z-index:1;">
          <tr>
            {sheet.columns.map((c) => (
              <th class={TH_CLS}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, i) => (
            <tr>
              {row.map((cell, j) => (
                <td class={TD_CLS}>
                  {cell === "" || cell === null || cell === undefined ? "\u00a0" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.total > sheet.rows.length && (
        <div class="px-2 py-1.5 text-xs text-ink-400 dark:text-ink-500 border-t border-ink/[0.08] dark:border-white/[0.08]">
          Showing first {sheet.rows.length.toLocaleString()} of {sheet.total.toLocaleString()} rows — download for the full data.
        </div>
      )}
    </div>
  );
}

export function InlineWorkbook({
  sheets,
  messageId,
  downloadHtml,
}: {
  sheets: WorkbookSheetView[];
  messageId: string;
  downloadHtml?: string;
}) {
  const group = `wb-${messageId}`;
  const safe = sheets.length > 0 ? sheets : [];

  return (
    <div>
      {downloadHtml ? (
        <div
          class="mb-2"
          dangerouslySetInnerHTML={{ __html: downloadHtml }}
        />
      ) : null}

      {safe.length > 1 && (
        <div class="flex gap-1 border-b border-ink/[0.08] dark:border-white/[0.08] mb-2 overflow-x-auto">
          {safe.map((sheet, i) => (
            <button
              type="button"
              data-tabbtn={group}
              data-tabkey={String(i)}
              onclick={`wfpShowTab('${group}','${i}')`}
              aria-selected={i === 0 ? "true" : "false"}
              class={`px-3 py-1.5 text-xs font-medium border-b-2 whitespace-nowrap ${
                i === 0
                  ? "text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400"
                  : "text-gray-500 dark:text-gray-400 border-transparent"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {safe.map((sheet, i) => (
        <div
          data-tabpanel={group}
          data-tabkey={String(i)}
          class={i === 0 ? "" : "hidden"}
        >
          <ReadOnlyGrid sheet={sheet} />
        </div>
      ))}
    </div>
  );
}
