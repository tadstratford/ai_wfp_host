import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';

/**
 * Chat Download Tool
 * Embeds a download button (and inline preview) in the chat for a value a
 * prior step produced — typically a self-contained HTML report.
 *
 * Wired with tool_parameters: { data: "{{report_html}}", filename: "report.html" }.
 */
export const Tool_run = async (api: WFP_API): Promise<Result> => {
    const widget = api.getParameter('widget');
    const data = api.getParameter('data');
    const filename = api.getParameter('filename');

    if (widget) {
        let parsed: unknown = data ?? {};
        if (typeof data === 'string' && data.trim()) {
            try {
                parsed = JSON.parse(data);
            } catch {
                return { status: 'error', statusMessage: `Invalid JSON for widget "${widget}"` };
            }
        }
        api.renderWidget(String(widget), parsed, filename ? String(filename) : undefined);
        return { status: 'success' };
    }

    const resolvedFilename = String(filename ?? 'report.html');
    if (data === undefined || data === null || data === '') {
        api.addMessage({
            role: 'tool',
            markdown: 'Download skipped — no data was produced for this step.',
        });
        return { status: 'success', statusMessage: 'No data to download' };
    }

    const content = typeof data === 'string' ? data : JSON.stringify(data);
    api.renderReport(content, resolvedFilename);

    return { status: 'success' };
};

export const tool_definition = async (): Promise<ToolDefinition> => ({
    tool_id: 'chat_download',
    name: 'Chat Download',
    apiVersion: '1.0.0',
    description: 'Embeds a download button in the chat for a value produced by a previous step (an HTML report, or a rendered widget).',
    description_md: `## What it does
Presents a value produced by a previous step as a downloadable file in the chat, with an inline preview for HTML. Use this as the final delivery step for generated reports.

## Inputs
- **widget** — (optional) a registered widget name (e.g. \`account-table\`). When set, **data** is the widget's JSON payload and the host renders it server-side.
- **data** — the value to download, usually \`{{html_report}}\` from the report-building tool, or the widget's JSON payload when **widget** is set
- **filename** — the file name for the download (e.g. "report.html")
- **label** — optional label for the download button (unused; shown by the host)

## Outputs
None. Emits a download button + inline preview in the session chat.

## Notes
For HTML reports the report tool should already call \`api.renderReport\`; this node is the delivery step that exposes the report for download. For widgets, pass \`widget\` + JSON \`data\` and the host renders via \`api.renderWidget\`.`,
    category: 'file',

    inputs: [
        { name: 'widget', type: 'string', value: '', required: false },
        { name: 'data', type: 'string', value: '', required: true },
        { name: 'filename', type: 'string', value: 'report.html', required: false },
        { name: 'label', type: 'string', value: '', required: false },
    ],
    outputs: [],
});
