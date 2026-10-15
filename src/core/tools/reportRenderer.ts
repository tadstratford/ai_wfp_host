export type ReportContentType = "html" | "csv" | "json" | "text";

const MIME: Record<ReportContentType, string> = {
  html: "text/html",
  csv: "text/csv",
  json: "application/json",
  text: "text/plain",
};

export function buildReportMessage(
  content: string,
  filename: string,
  sessionId?: string,
  contentType: ReportContentType = "html",
  messageId?: string,
): { html: string; json: { reportHtml: string; messageId: string; contentType: ReportContentType } } {
  const mime = MIME[contentType] ?? MIME.html;
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  const dataUri = `data:${mime};base64,${b64}`;
  const resolvedMessageId = messageId ?? Date.now().toString();
  const reportUrl = sessionId
    ? `/sessions/report?session_id=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(resolvedMessageId)}`
    : "";

  const downloadBtn = `<a
    href="${dataUri}"
    download="${filename}"
    style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;border:2px solid #2563eb;"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
      <path fill-rule="evenodd" d="M12 2.25a.75.75 0 0 1 .75.75v11.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06l3.22 3.22V3a.75.75 0 0 1 .75-.75Zm-9 13.5a.75.75 0 0 1 .75.75v2.25a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5V16.5a.75.75 0 0 1 1.5 0v2.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V16.5a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" />
    </svg>
    Download
  </a>`;

  // Open-in-new-tab only makes sense for HTML (the report route returns HTML).
  const openTabBtn = contentType === "html" && sessionId
    ? ` <a
      href="${reportUrl}"
      target="_blank"
      rel="noopener noreferrer"
      onclick="window.open(this.href, '_blank'); return false;"
      style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;background:#fff;color:#2563eb;border:2px solid #2563eb;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;font-family:sans-serif;margin-left:8px;"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
      Open in new tab
    </a>`
    : "";

  const inlinePreview = contentType === "html"
    ? `<div style="margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <iframe src="${dataUri}" sandbox="" style="width:100%;height:480px;border:none;background:#fff;" loading="lazy"></iframe>
  </div>`
    : "";

  const dataHint = contentType !== "html"
    ? `<div style="margin-top:12px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;color:#475569;font-size:13px;font-family:sans-serif;">
    Download this file, then load it via the <strong>Data page</strong> to keep it in your workspace with privacy masking applied.
  </div>`
    : "";

  return {
    html: `<div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:8px;">${downloadBtn}${openTabBtn}</div>
      ${inlinePreview}
      ${dataHint}
    </div>`,
    json: { reportHtml: content, messageId: resolvedMessageId, contentType },
  };
}
