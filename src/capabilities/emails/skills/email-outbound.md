---
name: email-outbound
group: email-outbound
description: Send outbound email via Resend, subject to the workspace outbound allowlist.
scope: chat
tools: [{"name":"send_email","role":"send an outbound email (allowlist-enforced)"},{"name":"show_message","role":"present the message for confirmation"}]
---

## Instructions
1. Compose the subject and body (plain text, or HTML for a generated report), then call `send_email`.
2. Outbound email is sent only to recipients on the workspace outbound allowlist — `send_email` rejects off-list recipients. If it rejects, tell the user which address is not allowed.
3. Never send without a recipient explicitly named by the user or in the task.
