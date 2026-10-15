import type { SharedWorkflowMeta } from "@backend/core/workspace/shareWorkflow";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@workflowpeople.com";

interface ShareEmailParams {
  recipientEmail: string;
  meta: SharedWorkflowMeta;
  shareUrl: string;
}

export async function sendShareEmail(
  params: ShareEmailParams,
): Promise<{ success: boolean; message: string }> {
  if (!RESEND_API_KEY) {
    console.log("[sendShareEmail] RESEND_API_KEY not set.");
    return { success: false, message: "Email service not configured." };
  }

  const { recipientEmail, meta, shareUrl } = params;
  const expiresDate = new Date(meta.expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const html = buildEmailHtml(meta, shareUrl, expiresDate);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Workflow People <${FROM_EMAIL}>`,
        to: recipientEmail,
        subject: `${meta.senderName} shared a workflow: ${meta.workspaceName}`,
        html,
        text: `${meta.senderName} sent you a workflow: ${meta.workspaceName}. Open it here: ${shareUrl} (expires ${expiresDate}). You'll need the passphrase from the sender to decrypt it.`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[sendShareEmail] Resend error:", res.status, body);
      return { success: false, message: "Failed to send email. Please try again." };
    }

    console.log(`[Share] Email sent to ${recipientEmail} for share ${meta.uuid}`);
    return { success: true, message: "Email sent." };
  } catch (err) {
    console.error("[sendShareEmail] Error:", err);
    return { success: false, message: "Failed to send email. Please try again." };
  }
}

function buildEmailHtml(meta: SharedWorkflowMeta, shareUrl: string, expiresDate: string): string {
  const sharedDate = new Date(meta.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#fafaf8;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">

      <!-- Logo -->
      <p style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:24px;">
        <span style="display:inline-block;width:24px;height:24px;background:#eef2ff;border:2px solid #534ab7;border-radius:4px;text-align:center;line-height:22px;font-size:12px;vertical-align:middle;margin-right:6px;">&#128188;</span>
        Workflow <span style="color:#534ab7;">People</span>
      </p>

      <!-- Context -->
      <p style="font-size:13px;color:#555550;margin-bottom:20px;">
        ${escHtml(meta.senderName)} sent you a workflow
      </p>

      <!-- Card -->
      <table cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid rgba(0,0,0,0.1);border-radius:16px;padding:32px;width:100%;max-width:420px;">
        <tr><td>

          <!-- Title -->
          <p style="font-size:21px;font-weight:500;line-height:1.3;margin:0 0 4px;">${escHtml(meta.workspaceName)}</p>
          <p style="font-size:13px;color:#444440;margin:0 0 28px;">
            From ${escHtml(meta.senderName)} &nbsp;&middot;&nbsp; ${sharedDate}
          </p>

          <!-- Meta grid -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              <td style="background:#f6f5f0;border-radius:8px;padding:10px 14px;width:48%;">
                <p style="font-size:11px;color:#777770;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 3px;">workflows</p>
                <p style="font-size:14px;font-weight:500;margin:0;">${meta.preview.workflowCount}</p>
              </td>
              <td style="width:4%;"></td>
              <td style="background:#f6f5f0;border-radius:8px;padding:10px 14px;width:48%;">
                <p style="font-size:11px;color:#777770;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 3px;">tools</p>
                <p style="font-size:14px;font-weight:500;margin:0;">${meta.preview.toolCount}</p>
              </td>
            </tr>
          </table>

          <!-- Encryption badge -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#e1f5ee;border:1px solid #9fe1cb;border-radius:8px;padding:10px 14px;margin-bottom:28px;">
            <tr>
              <td style="width:17px;vertical-align:top;padding-top:3px;">
                <div style="width:8px;height:8px;border-radius:50%;background:#1d9e75;"></div>
              </td>
              <td style="font-size:13px;color:#085041;line-height:1.55;">
                Encrypted by sender &nbsp;&middot;&nbsp; you'll need the passphrase to open
              </td>
            </tr>
          </table>

          <!-- CTA -->
          <a href="${escHtml(shareUrl)}" style="display:block;width:100%;background:#534ab7;color:#ffffff;border-radius:8px;padding:13px;font-size:15px;font-weight:500;text-align:center;text-decoration:none;margin-bottom:14px;">
            Open in Workflow People
          </a>

          <p style="font-size:12px;color:#777770;text-align:center;line-height:1.65;margin:0;">
            This link expires ${expiresDate}.<br>
            Free to open and run. No account required to view.
          </p>

        </td></tr>
      </table>

      <!-- Below card -->
      <p style="font-size:13px;color:#777770;margin-top:24px;">
        New to Workflow People? <a href="https://www.workflowpeople.com" style="color:#534ab7;text-decoration:none;">See how it works &rarr;</a>
      </p>

    </td></tr>
  </table>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
