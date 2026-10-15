// inboundEmail/attachments — shared attachment text decoding.
//
// Both the app-wfp-emails MCP tool (`get_email_attachment_content`) and the
// email audit need to turn a base64 attachment into readable text. Keep the
// heuristic in one place so the two stay in sync.

import type { InboundEmailAttachment } from "./types";

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/csv",
  "application/javascript",
];

const MAX_ATTACHMENT_TEXT = 8000;

/**
 * Decode an attachment's base64 content to text when it looks text-like,
 * otherwise return a short placeholder. Mirrors the logic previously inlined
 * in the `get_email_attachment_content` MCP tool.
 */
export function decodeAttachmentText(att: InboundEmailAttachment): string {
  const mime = (att.mime_type ?? "").toLowerCase();
  const isTextLike = TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p));

  try {
    const bytes = Buffer.from(att.content_base64 ?? "", "base64");
    const decoded = bytes.toString("utf8");
    // Heuristic: treat as text if mime is text-like OR the bytes are mostly printable UTF-8.
    const printable =
      decoded.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").length /
      Math.max(decoded.length, 1);
    if (isTextLike || printable > 0.9) {
      return decoded.slice(0, MAX_ATTACHMENT_TEXT);
    }
    return `<binary attachment — ${att.size_bytes ?? bytes.length} bytes>`;
  } catch {
    return `<could not decode attachment — ${att.size_bytes ?? 0} bytes>`;
  }
}
