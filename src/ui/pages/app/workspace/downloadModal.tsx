import { Context } from "hono";

/**
 * GET /app/modal/download-workspace — modal for downloading the active workspace
 * as a .wfp file. Rendered into #modal-container. Uses modalHelpers.js for
 * cancel/backdrop close.
 */
export const workspaceDownloadModalHandler = async (c: Context) => {
  return c.html(
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-ink-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-1">Download .wfp</h2>
        <p class="text-sm text-ink-500 dark:text-ink-400 mb-4">Choose what to exclude from the export.</p>
        <form
          method="get"
          action="/app/workspace/api/export"
          onsubmit="setTimeout(function(){var mc=document.getElementById('modal-container');if(mc){mc.innerHTML='';mc.classList.add('hidden');}},0)"
        >
          <div class="space-y-2 mb-5">
            <label class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80 cursor-pointer">
              <input type="checkbox" name="strip" value="logs" class="rounded border-ink/20 text-brand-500 focus:ring-brand-500" />
              Exclude logs
            </label>
            <label class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80 cursor-pointer">
              <input type="checkbox" name="strip" value="sessions" class="rounded border-ink/20 text-brand-500 focus:ring-brand-500" />
              Exclude sessions
            </label>
            <label class="flex items-center gap-2 text-sm text-ink-700 dark:text-white/80 cursor-pointer">
              <input type="checkbox" name="strip" value="provenance" class="rounded border-ink/20 text-brand-500 focus:ring-brand-500" />
              Exclude history (Time Machine)
            </label>
          </div>
          <div class="flex items-center justify-end gap-2">
            <button
              type="button"
              id="cancel-workspace-download-modal"
              class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              Download
            </button>
          </div>
        </form>
      </div>
    </div>,
  );
};
