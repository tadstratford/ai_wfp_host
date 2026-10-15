export interface BetaRequestData {
    name?: string;
    email: string;
    company?: string;
    message?: string;
}

/**
 * Send a beta-access / demo request via Resend. The visitor asks for a demo;
 * the operator then allowlists their email and hands out a beta code.
 */
export const sendBetaRequestEmail = async (data: BetaRequestData): Promise<{ success: boolean; message: string }> => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TO_EMAIL = process.env.BETA_REQUEST_TO_EMAIL;
    if (!RESEND_API_KEY || !TO_EMAIL) {
        console.log("[sendBetaRequestEmail] RESEND_API_KEY or BETA_REQUEST_TO_EMAIL not set.");
        return { success: false, message: "Email service not configured." };
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: "Workflow People <noreply@workflowpeople.com>",
                to: TO_EMAIL,
                reply_to: data.email,
                subject: `Beta access request: ${data.name || data.email}`,
                text: [
                    data.name ? `Name: ${data.name}` : null,
                    `Email: ${data.email}`,
                    data.company ? `Company: ${data.company}` : null,
                    "",
                    data.message || "(no message)",
                ].filter(Boolean).join("\n"),
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            console.error("[sendBetaRequestEmail] Resend error:", res.status, body);
            return { success: false, message: "Failed to send request. Please try again." };
        }

        return { success: true, message: "Request sent." };
    } catch (err) {
        console.error("[sendBetaRequestEmail] Error:", err);
        return { success: false, message: "Failed to send request. Please try again." };
    }
};
