import { z } from "zod";
import { defineTool } from "../../tool";
import { requireWorkspaceId } from "../scope";
import { sendWorkspaceEmail, getAttachmentById } from "@backend/core/workspace/emailInbox";

export default defineTool({
  name: "send_email",
  description: "Sends an outbound email via Resend. Set reply_to to the workspace inbox address so replies route back. Set cc to copy additional recipients and attachment_ids to forward inbound attachment content. Pass html to send an HTML body (e.g. an inlined report) and attachment_filename + attachment_content to attach a generated report file.",
  class: "control",
  output: { metaType: "text", tabular: false },
  mutating: true,
  durable: true,
  inputSchema: {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Subject line"),
    body: z.string().describe("Plain-text email body"),
    reply_to: z.string().optional().describe("Reply-to address (e.g. the workspace wf-…@in.workflowpeople.com inbox)"),
    cc: z.string().optional().describe("Comma-separated cc recipient email address(es)"),
    attachment_ids: z.array(z.string()).optional().describe("Inbound attachment ids to attach (from get_email_attachments)"),
    html: z.string().optional().describe("HTML email body (e.g. a generated report inlined as the message)"),
    attachment_filename: z.string().optional().describe("Filename for a generated report to attach (e.g. break-report.html)"),
    attachment_content: z.string().optional().describe("Raw content of that generated file (HTML/CSV); base64-encoded for sending"),
  },
  handler: async ({ to, subject, body, reply_to, cc, attachment_ids, html, attachment_filename, attachment_content }) => {
    const workspaceId = requireWorkspaceId();

    const attachments: { filename: string; content: string }[] = [];
    for (const id of attachment_ids ?? []) {
      const att = await getAttachmentById(id);
      if (att?.content_base64) {
        attachments.push({ filename: att.filename ?? "attachment", content: att.content_base64 });
      }
    }

    if (attachment_filename && attachment_content) {
      attachments.push({
        filename: attachment_filename,
        content: Buffer.from(attachment_content, "utf-8").toString("base64"),
      });
    }

    const res = await sendWorkspaceEmail(workspaceId, {
      to,
      subject,
      text: body,
      html: html || undefined,
      replyTo: reply_to,
      cc,
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    if (!res.success) {
      return { content: [{ type: "text" as const, text: res.message }], isError: true };
    }
    return { content: [{ type: "text" as const, text: `Email sent to ${to}.` }] };
  },
});
