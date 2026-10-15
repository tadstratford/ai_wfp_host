// Inbound email webhook — POST /inbound/email
//
// Receives a Resend inbound webhook (Svix-signed). The webhook payload is an
// `{ type, data }` envelope containing only METADATA — the email body, headers
// and attachment content must be fetched from the Resend Receiving API:
//   - GET /emails/receiving/{id}                      → html, text, headers, attachments[]
//   - GET /emails/receiving/{id}/attachments/{attId}  → { download_url }
//   - fetch download_url                              → raw attachment bytes
//
// Auth: signature + `wf-<key>.<secret>@domain` (key+secret) + optional allowlist.
// Storage: archive into Supabase (store-only — no workspace is opened).
//
// DEV ONLY: when NODE_ENV !== "production", a request carrying the
// `x-inbound-dev: 1` header is treated as a raw inline email (no Svix
// signature, no Resend fetch) so the full pipeline can be driven directly
// against `http://localhost:3000/inbound/email`. The production signature path
// below is untouched.

import { Hono } from "hono";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import {
  writeEmail,
  writeAttachments,
  processInboundEmail,
  writeUserInboundEmail,
  resolveInboundEmail,
  MAX_INBOUND_EMAIL_BYTES,
  runInboundTest,
} from "@backend/core/workspace/emailInbox";
import type { InboundEmail } from "@backend/core/workspace/emailInbox";
import { sendInboundRejectEmail } from "@backend/core/email/sendInboundRejectEmail";

const RESEND_API = "https://api.resend.com";

// ── Svix / Resend signature verification ─────────────────────────────────────

function verifySignature(
  secret: string,
  id: string,
  timestamp: string,
  signatureHeader: string,
  rawBody: string,
): boolean {
  if (!id || !timestamp || !signatureHeader) return false;

  const signedPayload = `${id}.${timestamp}.${rawBody}`;

  // Candidate HMAC keys, in Svix/Resend-correct order:
  //  1. `whsec_`-stripped then base64-decoded  (the documented signing-secret format)
  //  2. whole value base64-decoded
  //  3. raw utf8
  const keys: Buffer[] = [];
  const stripped = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    const decoded = Buffer.from(stripped, "base64");
    if (decoded.length > 0) keys.push(decoded);
  } catch { /* ignore */ }
  try {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length > 0) keys.push(decoded);
  } catch { /* ignore */ }
  keys.push(Buffer.from(secret, "utf8"));

  const parts = signatureHeader
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"));

  for (const part of parts) {
    const provided = Buffer.from(part.slice(3), "base64");
    for (const key of keys) {
      const expected = createHmac("sha256", key).update(signedPayload).digest();
      if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
        return true;
      }
    }
  }
  return false;
}

// ── Resend API helpers ───────────────────────────────────────────────────────

async function resendGet(path: string): Promise<any | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${RESEND_API}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(`[inbound] Resend API ${path} → ${res.status} ${await res.text()}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[inbound] Resend API ${path} failed:`, err);
    return null;
  }
}

async function downloadToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch (err) {
    console.error("[inbound] attachment download failed:", err);
    return null;
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

export const inboundRouter = new Hono();

inboundRouter.post("/email", async (c) => {
  const rawBody = await c.req.text();

  const isDevRaw =
    process.env.NODE_ENV !== "production" && c.req.header("x-inbound-dev") === "1";
  if (isDevRaw) {
    return handleDevRaw(c, rawBody);
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;

  // 1. Signature — reject anything that isn't a signed Resend webhook.
  const id = c.req.header("svix-id") ?? "";
  const timestamp = c.req.header("svix-timestamp") ?? "";
  const signature = c.req.header("svix-signature") ?? "";
  if (!secret || !verifySignature(secret, id, timestamp, signature, rawBody)) {
    console.warn("[inbound] Rejected webhook: invalid or missing signature");
    return c.text("Unauthorized", 401);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn("[inbound] Rejected webhook: unparseable body");
    return c.text("Bad request", 400);
  }

  if (event.type !== "email.received") {
    return c.text("OK", 200);
  }

  const data = event.data ?? {};
  const emailId = typeof data.email_id === "string" ? data.email_id : null;
  if (!emailId) {
    console.warn("[inbound] Dropped email: missing email_id");
    return c.text("OK", 200);
  }

  // 2. Resolve key + secret from the recipient address(es), then apply the
  // workspace + server allowlists. Shared with the dev raw entrance.
  const recipients = [
    ...(Array.isArray(data.to) ? data.to : []),
    ...(Array.isArray(data.received_for) ? data.received_for : []),
  ].map(String);

  const resolved = await resolveInboundEmail(recipients, String(data.from ?? ""));
  if (!resolved.accepted) {
    console.warn(`[inbound] Dropped email: ${resolved.dropReason}`);
    return c.text("OK", 200);
  }

  const addressRow = resolved.addressRow;
  const userAddressRow = resolved.userAddressRow;
  const fromEmail = resolved.fromEmail!;
  const fromName = resolved.fromName;

  // 3. Fetch the full email (body + headers + attachment metadata).
  const full = await resendGet(`/emails/receiving/${emailId}`);
  const subject = (typeof full?.subject === "string" ? full.subject : data.subject) ?? "";
  const textBody = typeof full?.text === "string" ? full.text : "";
  const htmlBody = typeof full?.html === "string" ? full.html : "";
  const headers = full?.headers ?? undefined;
  const messageId = full?.message_id ?? data.message_id ?? null;
  const attachmentMeta: any[] = Array.isArray(full?.attachments) ? full.attachments : [];

  // 4. Size cap (using metadata sizes — before downloading any attachment).
  let totalBytes =
    Buffer.byteLength(textBody, "utf8") +
    Buffer.byteLength(htmlBody, "utf8") +
    Buffer.byteLength(subject, "utf8");
  for (const a of attachmentMeta) totalBytes += Number(a.size ?? 0);

  if (totalBytes > MAX_INBOUND_EMAIL_BYTES) {
    console.warn(`[inbound] Rejected oversized email from ${fromEmail} (${totalBytes} bytes)`);
    await sendInboundRejectEmail(fromEmail, totalBytes);
    return c.text("OK", 200);
  }

  // 5. Download attachment contents.
  const attachments = [];
  for (const a of attachmentMeta) {
    const attId = a.id;
    let contentBase64 = "";
    let mimeType = a.content_type ?? null;
    let filename = a.filename ?? "attachment";
    let sizeBytes = Number(a.size ?? 0);

    const meta = await resendGet(`/emails/receiving/${emailId}/attachments/${attId}`);
    if (meta?.download_url) {
      const downloaded = await downloadToBase64(meta.download_url);
      if (downloaded !== null) contentBase64 = downloaded;
      if (meta.filename) filename = meta.filename;
      if (meta.content_type) mimeType = meta.content_type;
      if (meta.size != null) sizeBytes = Number(meta.size);
    }

    attachments.push({ filename, mimeType, sizeBytes, contentBase64 });
  }

  // 6. Store.
  const storedId = randomUUID();
  const entry = {
    textBody: textBody || undefined,
    htmlBody: htmlBody || undefined,
    headers,
  };
  const emailDate = full?.created_at ?? data.created_at ?? new Date().toISOString();

  const attachmentRows = attachments.map((a) => ({
    attachment_id: randomUUID(),
    email_id: storedId,
    filename: a.filename,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    content_base64: a.contentBase64,
  }));

  if (addressRow) {
    const email: InboundEmail = {
      email_id: storedId,
      workspace_id: addressRow.workspace_id,
      from_email: fromEmail,
      from_name: fromName,
      to_address: recipients.join(", "),
      subject: subject || null,
      date: emailDate,
      thread_id: messageId,
      size_bytes: totalBytes,
      status: "received",
      session_id: null,
      created_at: new Date().toISOString(),
      entry,
    };

    await writeEmail(email);
    await writeAttachments(attachmentRows);

    console.log(
      `[inbound] Stored email ${storedId} → workspace ${addressRow.workspace_id} from ${fromEmail}`,
    );

    // Headless email agent — interpret + act via skills (no workflows). Runs
    // async after the 200 so Resend isn't blocked on LLM latency.
    if (process.env.EMAIL_AGENT_ENABLED !== "false") {
      processInboundEmail(email, addressRow).catch((err) => {
        console.error(`[inbound] email-agent failed for ${storedId}:`, err);
      });
    }
  } else if (userAddressRow) {
    await writeUserInboundEmail({
      email_id: storedId,
      user_id: userAddressRow.user_id,
      from_email: fromEmail,
      from_name: fromName,
      to_address: recipients.join(", "),
      subject: subject || null,
      date: emailDate,
      thread_id: messageId,
      size_bytes: totalBytes,
      entry,
    });
    await writeAttachments(attachmentRows);

    console.log(
      `[inbound] Stored email ${storedId} → user ${userAddressRow.user_id} from ${fromEmail}`,
    );
    // Archive-only — no workflow agent for user-level inboxes.
  }

  return c.text("OK", 200);
});

// ── Dev-only raw entrance (x-inbound-dev: 1) ─────────────────────────────────
// Same routing + allowlist + size + shadow-agent pipeline as the webhook, but
// the body is supplied inline and the Svix signature / Resend fetch are skipped.

async function handleDevRaw(c: any, rawBody: string): Promise<Response> {
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ accepted: false, dropReason: "Unparseable body", checks: [] }, 400);
  }

  const result = await runInboundTest({
    from: String(payload.from ?? ""),
    to: String(payload.to ?? ""),
    subject: String(payload.subject ?? ""),
    text: String(payload.text ?? payload.textBody ?? ""),
    html: String(payload.html ?? payload.htmlBody ?? ""),
  });

  return c.json(result);
}
