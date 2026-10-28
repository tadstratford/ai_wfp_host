/**
 * InlinePlan — the "Plan" story beat (step 5). Renders the LLM-composed,
 * Jev-verified remediation actions as an ordered list, each row's refs clickable
 * to the underlying display element via the shared review-detail endpoint.
 */

interface StoryAction {
  label: string;
  refs: string[];
}

export function InlinePlan({
  actions,
  sessionId,
}: {
  actions: StoryAction[];
  sessionId?: string;
}) {
  const list = actions ?? [];

  return (
    <div style="margin:-16px;margin-top:0">
      <div style="border-top:3px solid #3E8DE1;background:#ffffff">
        <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb">
          <span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280">
            Plan — how to resolve it
          </span>
          <span style="font-size:12px;color:#6b7280">
            {list.length} action{list.length === 1 ? "" : "s"}
          </span>
        </div>

        <div style="padding:10px 14px;border-bottom:1px solid #e5e7eb">
          {list.length === 0 ? (
            <div style="font-size:13px;color:#374151">No actions needed — the data ties.</div>
          ) : (
            <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">
              {list.map((a, i) => (
                <li key={i} style="font-size:13px;color:#374151;line-height:1.5">
                  <div>{a.label}</div>
                  {(a.refs?.length ?? 0) > 0 && (
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
                      {a.refs.map((r) => (
                        <span
                          data-ref={r}
                          style="display:inline-flex;align-items:center;padding:1px 6px;border-radius:4px;background:#eef2ff;color:#4f46e5;font-size:11px;font-weight:600;cursor:pointer"
                          title="Click for detail"
                          hx-post={`/sessions/api/review-detail?sessionId=${sessionId ?? ""}&ref=${r}`}
                          hx-swap="none"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
