/**
 * Shared modal for Make Workflow (build) and Modify Workflow flows.
 *
 * Build mode opens on a "choose a starting point" step: accounting-shaped entry
 * points (the AI writes the checklist from a shape you recognise) plus a
 * free-form describe box. Modify mode is a straight describe box.
 *
 * Both modes post to `/app/new-workflow`. The handler reads the optional
 * `workflowId` hidden field to decide which pipeline to fire.
 */

export const ENTRY_POINTS: { label: string; desc: string; icon: string; template: string }[] = [
  {
    label: "Month-end close",
    desc: "A close checklist for the period",
    icon: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5",
    template: "Set up a month-end close for this client: reconcile the bank, review transactions, and produce the period financial statements.",
  },
  {
    label: "Bank reconciliation",
    desc: "Match statements against the books",
    icon: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
    template: "Reconcile the bank statement against the ledger and flag every difference for review.",
  },
  {
    label: "Vendor invoices",
    desc: "Collect, categorize, and summarize payables",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
    template: "Collect and categorize vendor invoices, then prepare an accounts-payable summary.",
  },
  {
    label: "Capital calls",
    desc: "List investors, compute, and draft the notice",
    icon: "M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941",
    template: "Process a capital call: list investors, compute each allocation, and draft the notice for review.",
  },
  {
    label: "Payroll",
    desc: "Compute pay, withholdings, and deductions",
    icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    template: "Set up payroll: compute each employee's pay, withholdings, and deductions, then prepare the payroll summary for review.",
  },
  {
    label: "Process Email",
    desc: "Read inbound email, route it, draft a reply",
    icon: "M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75",
    template: "Process inbound email: extract the request, route it to the right workflow, and draft a reply for review before it sends.",
  },
];

export const WorkflowModal = ({
  mode,
  workflowId,
  workflowName,
}: {
  mode: "build" | "modify";
  workflowId?: string;
  workflowName?: string;
}) => {
  const isModify = mode === "modify";

  const title = isModify ? "Modify Workflow" : "Make Workflow";
  const subtitle = isModify
    ? `Describe the changes you want to make to "${workflowName || "this workflow"}".`
    : "Pick a starting point and the AI will draft the workflow. You review before it builds.";
  const placeholder = isModify
    ? "e.g., Change the report to show quarterly totals instead of monthly"
    : "Describe the workflow in your own words — e.g. \u201cRead my bank_data and make an HTML report showing total credits, debits, and net cash flow.\u201d";
  const buttonText = isModify ? "Modify" : "Build";
  const spinnerText = isModify ? "Starting..." : "Creating...";

  const entryCard =
    "group flex items-start gap-3 w-full text-left rounded-xl border border-ink/[0.08] dark:border-white/[0.08] p-3 hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors cursor-pointer";

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      id="new-workflow-modal-backdrop"
    >
      <div class="bg-white dark:bg-ink-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-extrabold tracking-tight text-ink dark:text-white mb-1">
          {title}
        </h2>
        <p class="text-sm text-ink-500 mb-4">
          {subtitle}
        </p>

        {!isModify && (
          <div class="grid sm:grid-cols-1 gap-2 mb-4">
            {ENTRY_POINTS.map((e) => (
              <form
                hx-post="/app/new-workflow"
                hx-target="#modal-container"
                hx-swap="innerHTML"
                hx-indicator="#new-workflow-spinner"
              >
                <input type="hidden" name="description" value={e.template} />
                <button type="submit" class={entryCard}>
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d={e.icon} />
                    </svg>
                  </span>
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold text-ink dark:text-white">{e.label}</span>
                    <span class="block text-xs text-ink-500">{e.desc}</span>
                  </span>
                </button>
              </form>
            ))}
          </div>
        )}

        <div
          id="new-workflow-spinner"
          class="htmx-indicator flex items-center justify-center gap-2 py-1"
        >
          <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500"></div>
          <span class="text-xs text-ink-400">{spinnerText}</span>
        </div>

        <form
          hx-post="/app/new-workflow"
          hx-target="#modal-container"
          hx-swap="innerHTML"
          hx-indicator="#new-workflow-spinner"
        >
          {workflowId && (
            <input type="hidden" name="workflowId" value={workflowId} />
          )}
          <textarea
            name="description"
            rows={4}
            placeholder={placeholder}
            required
            autofocus={isModify}
            class="w-full border border-ink/[0.12] dark:border-white/[0.1] rounded-xl px-3 py-2 text-sm bg-[#F3F5F9] dark:bg-ink-900 text-ink dark:text-white placeholder:text-ink-400 focus:outline-none focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:focus:bg-ink-900 dark:focus:ring-brand-900 mb-3 overflow-y-auto"
            style="min-height:80px; max-height:300px"
          />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              id="cancel-new-workflow-modal"
              class="rounded-xl border border-ink/[0.1] hover:bg-ink/[0.04] px-4 py-2.5 text-sm font-semibold text-ink-600 dark:border-white/[0.1] dark:text-white/80 dark:hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              {buttonText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
