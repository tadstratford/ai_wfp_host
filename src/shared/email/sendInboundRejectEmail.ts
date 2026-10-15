const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@workflowpeople.com";

/**
 * Reply to a sender whose inbound email was rejected for being too large.
 * Best-effort: a failed reply is logged but never blocks the webhook.
 */
export async function sendInboundRejectEmail(
  senderEmail: string,
  sizeBytes: number,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.log("[sendInboundRejectEmail] RESEND_API_KEY not set — no reply sent.");
    return;
  }

  const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Workflow People <${FROM_EMAIL}>`,
        to: senderEmail,
        reply_to: FROM_EMAIL,
        subject: "Your email could not be stored",
        text:
          `Your email to Workflow People could not be stored because it was too large ` +
          `(${mb} MB). The maximum size is 1 MB including attachments. ` +
          `Please send a smaller email or split the attachments across multiple emails.`,
      }),
    });

    if (!res.ok) {
      console.error("[sendInboundRejectEmail] Resend error:", res.status, await res.text());
      return;
    }
    console.log(`[inbound] Sent too-large reply to ${senderEmail}`);
  } catch (err) {
    console.error("[sendInboundRejectEmail] Error:", err);
  }
}
