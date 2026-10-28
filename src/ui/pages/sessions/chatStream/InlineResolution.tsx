/**
 * InlineResolution — the "Resolution" story beat (step 7). Shows what was
 * produced: the prebuilt report download/preview card (report-only) plus a
 * compact recap of the remediation actions. Journal posting is deferred (not
 * rendered here).
 */

interface StoryAction {
  label: string;
  refs: string[];
}

export function InlineResolution({
  actions,
  reportHtml,
  reportCardHtml,
}: {
  actions: StoryAction[];
  /** Presence signals "a report was delivered" (the report route also reads it). */
  reportHtml?: string;
  /** The prebuilt download/preview card HTML (message.html). */
  reportCardHtml?: string;
}) {
  const list = actions ?? [];
  const hasReport = !!reportHtml;

  return (
    <div style="margin:-16px;margin-top:0">
      <div style="border-top:3px solid #16a34a;background:#ffffff">
        <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb">
          <span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">
            Resolution — outputs
          </span>
          {hasReport && (
            <span style="font-size:12px;color:#6b7280">error report delivered</span>
          )}
        </div>

        <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
          {!hasReport && list.length === 0 ? (
            <div style="font-size:13px;color:#374151">No adjustments needed — the data ties.</div>
          ) : (
            <div style="display:flex;flex-direction:column;gap:6px">
              {list.length > 0 && (
                <div>
                  <div style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px">
                    Resolved
                  </div>
                  <ul style="margin:0;padding-left:18px;font-size:12.5px;color:#374151">
                    {list.map((a, i) => (
                      <li key={i} style="margin:3px 0">{a.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasReport && reportCardHtml && (
                <div
                  style="margin-top:4px"
                  dangerouslySetInnerHTML={{ __html: reportCardHtml }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
