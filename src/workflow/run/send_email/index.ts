import { WFP_API, Result, ToolDefinition } from '@backend/core/wfp';

export const Tool_run = async (api: WFP_API): Promise<Result> => {
    const emailsApi = api.emails;
    if (!emailsApi) return { status: 'error', error: 'Email tools are not available in this runner.' };

    const to = String(api.getParameter('to') ?? '').trim();
    const subject = String(api.getParameter('subject') ?? '').trim();
    const body = String(api.getParameter('body') ?? '');
    const html = String(api.getParameter('html') ?? '').trim();
    const replyTo = String(api.getParameter('reply_to') ?? '').trim();
    const cc = String(api.getParameter('cc') ?? '').trim();
    const rawAttachmentIds = api.getParameter('attachment_ids');
    const attachmentFilename = String(api.getParameter('attachment_filename') ?? '').trim();
    const attachmentContent = api.getParameter('attachment_content');

    if (!to) return { status: 'error', error: 'to is required.' };
    if (!subject) return { status: 'error', error: 'subject is required.' };
    if (!body && !html) return { status: 'error', error: 'body or html is required.' };

    // Resolve attachment ids (JSON array or comma-separated) into forwardable
    // attachments with their base64 content.
    let attachmentIds: string[] = [];
    if (typeof rawAttachmentIds === 'string' && rawAttachmentIds.trim()) {
      try {
        const parsed = JSON.parse(rawAttachmentIds);
        if (Array.isArray(parsed)) attachmentIds = parsed.map(String);
        else attachmentIds = [String(parsed)];
      } catch {
        attachmentIds = rawAttachmentIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
    } else if (Array.isArray(rawAttachmentIds)) {
      attachmentIds = rawAttachmentIds.map(String);
    }

    const attachments: { filename: string; content: string }[] = [];
    for (const id of attachmentIds) {
      const att = await emailsApi.getAttachment(id);
      if (att?.content_base64) {
        attachments.push({ filename: att.filename ?? 'attachment', content: att.content_base64 });
      }
    }

    // A generated attachment (a report produced by this workflow). Wire
    // `attachment_content` to a report parameter (e.g. {{html_report}}); its
    // content is base64-encoded for the Resend attachments array.
    if (attachmentFilename && attachmentContent !== undefined && attachmentContent !== null && attachmentContent !== '') {
      const rawContent = typeof attachmentContent === 'string' ? attachmentContent : JSON.stringify(attachmentContent);
      attachments.push({
        filename: attachmentFilename,
        content: Buffer.from(rawContent, 'utf-8').toString('base64'),
      });
    }

    const input = {
        to,
        subject,
        text: body || undefined,
        html: html || undefined,
        replyTo: replyTo || undefined,
        cc: cc || undefined,
        ...(attachments.length > 0 ? { attachments } : {}),
    };

    try {
        const res = await emailsApi.send(input);

        api.setParameter('result', res.message);
        api.setParameter('success', res.success);

        if (!res.success) return { status: 'error', error: res.message };

        api.addMessage({
            role: 'tool',
            markdown: `✓ Email sent to **${to}** — "${subject}".`,
        });

        return { status: 'success' };
    } catch (err: any) {
        return { status: 'error', error: err?.message ?? String(err) };
    }
};

export const tool_definition = async (): Promise<ToolDefinition> => ({
    tool_id: 'send_email',
    name: 'Send Email',
    apiVersion: '1.0.0',
    description: 'Send an outbound email via Resend, with an optional reply-to address.',
    description_md: `## What it does
Sends an email via Resend from the app's configured from-address. Set **reply_to** to the workspace inbox address so replies route back into the workflow.

## Inputs
- **to** — recipient email address
- **subject** — subject line
- **body** — plain-text email body (provide this and/or **html**)
- **html** — HTML email body (e.g. a generated report inlined as the message)
- **reply_to** — optional reply-to address (e.g. your \`wf-…@in.workflowpeople.com\` inbox)
- **cc** — optional comma-separated cc recipient(s)
- **attachment_ids** — optional JSON array (or comma-separated list) of inbound attachment ids to forward
- **attachment_filename** — optional filename for a generated report to attach (e.g. "break-report.html")
- **attachment_content** — optional raw content of that generated file (wire a report parameter, e.g. {{html_report}}); base64-encoded for sending

## Outputs
- **result** — success/failure message
- **success** — boolean outcome.`,
    category: 'emails',
    inputs: [
        { name: 'to', type: 'string', value: '', required: true },
        { name: 'subject', type: 'string', value: '', required: true },
        { name: 'body', type: 'string', value: '', required: false },
        { name: 'html', type: 'string', value: '', required: false },
        { name: 'reply_to', type: 'string', value: '', required: false },
        { name: 'cc', type: 'string', value: '', required: false },
        { name: 'attachment_ids', type: 'string', value: '', required: false },
        { name: 'attachment_filename', type: 'string', value: '', required: false },
        { name: 'attachment_content', type: 'string', value: '', required: false },
    ],
    outputs: [
        { name: 'result', type: 'string' },
        { name: 'success', type: 'boolean' },
    ],
});
