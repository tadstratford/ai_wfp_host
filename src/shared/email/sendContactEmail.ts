export interface ContactFormData {
    name: string;
    email: string;
    message: string;
}

/**
 * Send contact form submission via Resend.
 */
export const sendContactEmail = async (data: ContactFormData): Promise<{ success: boolean; message: string }> => {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL;
    if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
        console.log("[sendContactEmail] RESEND_API_KEY or CONTACT_TO_EMAIL not set.");
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
                to: CONTACT_TO_EMAIL,
                reply_to: data.email,
                subject: `Contact form: ${data.name}`,
                text: `Name: ${data.name}\nEmail: ${data.email}\n\n${data.message}`,
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            console.error("[sendContactEmail] Resend error:", res.status, body);
            return { success: false, message: "Failed to send message. Please try again." };
        }

        return { success: true, message: "Message sent." };
    } catch (err) {
        console.error("[sendContactEmail] Error:", err);
        return { success: false, message: "Failed to send message. Please try again." };
    }
};
