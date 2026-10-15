const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@workflowpeople.com";

export interface SendEmailInput {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  /** Override the From address (e.g. a user's own inbox address). */
  from?: string;
  replyTo?: string;
  cc?: string;
  /** Message-ID this email is replying to — set as In-Reply-To/References. */
  inReplyTo?: string;
  attachments?: { filename: string; content: string }[];
}

export interface SendEmailResult {
  success: boolean;
  message: string;
}

/**
 * Generic outbound email via Resend. `replyTo` defaults the reply-to header so
 * replies route back into the workspace inbox (the per-workspace inbound address).
 * `cc` is a comma-separated list of additional recipients; `attachments` are
 * base64 `content` blobs (Resend `attachments` array).
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    console.log("[sendEmail] RESEND_API_KEY not set.");
    return { success: false, message: "Email service not configured." };
  }

  const { to, subject, text, html, from, replyTo, cc, inReplyTo, attachments } = input;
  if (!to || !subject || (!text && !html)) {
    return { success: false, message: "to, subject, and text or html are required." };
  }

  const fromAddress = from || FROM_EMAIL;
  const payload: Record<string, unknown> = {
    from: `Workflow People <${fromAddress}>`,
    to,
    subject,
  };
  if (text) payload.text = text;
  if (html) payload.html = html;
  if (replyTo) payload.reply_to = replyTo;
  if (cc) payload.cc = cc;
  if (inReplyTo) {
    payload.headers = {
      "In-Reply-To": inReplyTo,
      "References": inReplyTo,
    };
  }
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
    }));
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[sendEmail] Resend error:", res.status, body);
      return { success: false, message: "Failed to send email. Please try again." };
    }

    console.log(`[sendEmail] Email sent to ${to}`);
    return { success: true, message: "Email sent." };
  } catch (err) {
    console.error("[sendEmail] Error:", err);
    return { success: false, message: "Failed to send email. Please try again." };
  }
}
