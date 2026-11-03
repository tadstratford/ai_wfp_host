/**
 * Thinking — the vers_11 "thinking" transparency card. Renders the routing,
 * rule-selection, plan, and execution beats as compact inline cards:
 *
 *   classify-options → prompt + candidate skills with probability bars
 *   classify-outcome → the picked skill(s)
 *   rules-options    → prompt + candidate workspace rules with probability bars
 *   rules-outcome    → the applying rules + their enforcement tier
 *   plan             → the plan's steps (label · tool · args, control gates)
 *   compose          → "Building a plan…"
 *   step-start       → "▶ <step label>"
 *
 * The live plan checklist stays in the right rail; these are the narrative
 * beats only, gated by `chatVerbose`.
 */

interface ThinkingOption {
  name: string;
  description?: string;
  prob: number;
}

interface ThinkingRule {
  name: string;
  tier: string;
  prob?: number;
}

interface ThinkingPlanStep {
  kind: string;
  label?: string;
  tool?: string;
  args?: Record<string, unknown>;
  control?: string;
  prompt?: string;
}

interface ThinkingLimits {
  threshold?: number;
  tagThreshold?: number;
  max?: number;
  label?: string;
}

const BRAND = "#3E8DE1";
const GREEN = "#22c55e";
const BORDER = "#e5e7eb";
const TEXT = "#374151";
const MUTED = "#6b7280";

function Lightning() {
  return (
    <svg class="w-3.5 h-3.5 shrink-0" style={`color:${BRAND}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function compact(body: any) {
  return (
    <div class="flex items-start gap-2 px-1 py-1 text-sm text-ink-600 dark:text-white/80">
      <span class="mt-0.5 shrink-0">{Lightning()}</span>
      <span>{body}</span>
    </div>
  );
}

function code(s: string) {
  return <code style={`font-size:12px;color:${BRAND}`}>{s}</code>;
}

/** A drill-back link from a thinking chip to the Skills page (filtered). */
function drill(text: string, href: string) {
  return (
    <a
      hx-get={href}
      hx-target="#main-panel"
      hx-swap="innerHTML"
      hx-push-url="true"
      style={`font-size:12px;color:${BRAND};text-decoration:underline;cursor:pointer`}
    >
      {text}
    </a>
  );
}

function header(prompt: string) {
  return (
    <div style={`padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid ${BORDER}`}>
      {Lightning()}
      <span style={`font-size:13px;font-weight:600;color:${TEXT}`}>{prompt}</span>
    </div>
  );
}

function optionCard(prompt: string, options: ThinkingOption[], limits?: ThinkingLimits) {
  const tickLeft =
    limits?.threshold != null ? Math.min(100, Math.max(0, limits.threshold * 100)) : null;
  return (
    <div style={`border-top:3px solid ${BRAND};background:#ffffff;border-radius:0 0 8px 8px`}>
      {header(prompt)}
      <div style="padding:8px 14px 12px">
        {options.length === 0 ? (
          <div style={`font-size:13px;color:${MUTED}`}>No candidates.</div>
        ) : (
          options.map((o, i) => {
            const prob = Number(o.prob) || 0;
            const pct = Math.round(prob * 100);
            const width = pct;
            return (
              <div key={i} style="display:flex;align-items:center;gap:10px;padding:3px 0">
                <span style={`font-size:13px;color:${TEXT};width:170px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>
                  {o.name}
                </span>
                <span style={`flex:1;height:6px;border-radius:9999px;background:${BORDER};overflow:hidden;position:relative`}>
                  <span style={`display:block;height:100%;border-radius:9999px;background:${BRAND};width:${width}%`} />
                  {tickLeft != null && width > tickLeft && (
                    <span style={`position:absolute;top:0;bottom:0;left:${tickLeft}%;right:${100 - width}%;background:${GREEN}`} />
                  )}
                  {tickLeft != null && (
                    <span style={`position:absolute;top:0;bottom:0;left:${tickLeft}%;width:1.5px;background:${TEXT};opacity:0.55`} />
                  )}
                </span>
                <span style={`font-size:12px;color:${MUTED};width:36px;text-align:right`}>{pct}%</span>
              </div>
            );
          })
        )}
        {limitsFooter(limits)}
      </div>
    </div>
  );
}

function limitsFooter(limits?: ThinkingLimits) {
  if (!limits || (limits.threshold == null && limits.tagThreshold == null && limits.max == null)) return null;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const parts: string[] = [];
  if (limits.threshold != null) parts.push(`≥${pct(limits.threshold)} probability`);
  if (limits.tagThreshold != null) parts.push(`≥${pct(limits.tagThreshold)} tag match`);
  if (limits.max != null) parts.push(`up to ${limits.max} ${limits.label ?? "items"}`);
  return (
    <div style={`margin-top:8px;padding-top:6px;border-top:1px dashed ${BORDER};font-size:11px;color:${MUTED}`}>
      Selection: {parts.join(" · ")}
    </div>
  );
}

function truncateArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "";
  try {
    const s = JSON.stringify(args);
    return s.length > 180 ? s.slice(0, 179) + "…" : s;
  } catch {
    return "";
  }
}

export function Thinking({ json }: { json: any }) {
  const stage = json?.stage;

  if (stage === "classify-options" || stage === "rules-options" || stage === "story-options") {
    const options: ThinkingOption[] = Array.isArray(json.options) ? json.options : [];
    const prompt =
      json.prompt ||
      (stage === "rules-options" ? "Figuring out which workspace rules apply…" : "Figuring out what type of problem this is…");
    return optionCard(prompt, options, json.limits as ThinkingLimits | undefined);
  }

  if (stage === "classify-outcome") {
    const chosen = Array.isArray(json.chosen) ? json.chosen : [];
    return compact(
      <span>
        Picked: {chosen.map((s: string, i: number) => (
          <span key={i}>
            {i > 0 ? ", " : ""}
            {drill(s, `/app/skills?skill=${encodeURIComponent(s)}`)}
          </span>
        ))}
      </span>,
    );
  }

  if (stage === "story-outcome") {
    const story = typeof json?.story === "string" ? json.story : null;
    return compact(
      <span>
        Story: {story ? drill(story, `/app/stories?story=${encodeURIComponent(story)}`) : <span style={`font-size:13px;color:${MUTED}`}>none</span>}
      </span>,
    );
  }

  if (stage === "rules-outcome") {
    const rules: ThinkingRule[] = Array.isArray(json.rules) ? json.rules : [];
    if (rules.length === 0) {
      return compact(<span>No workspace rules apply.</span>);
    }
    return compact(
      <span>
        Rules applying: {rules.map((r, i) => (
          <span key={i}>
            {i > 0 ? ", " : ""}
            {drill(r.name, `/app/skills?skill=${encodeURIComponent(r.name)}`)}
            <span style={`font-size:12px;color:${MUTED}`}> ({r.tier})</span>
          </span>
        ))}
      </span>,
    );
  }

  if (stage === "plan") {
    const steps: ThinkingPlanStep[] = Array.isArray(json.steps) ? json.steps : [];
    return (
      <div style={`border-top:3px solid ${BRAND};background:#ffffff;border-radius:0 0 8px 8px`}>
        {header("Plan")}
        <div style="padding:8px 14px 12px">
          {steps.length === 0 ? (
            <div style={`font-size:13px;color:${MUTED}`}>No steps.</div>
          ) : (
            <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
              {steps.map((s, i) => {
                if (s.kind === "control") {
                  const icon = s.control === "approval" ? "⏸" : "?";
                  return (
                    <li key={i} style={`font-size:13px;color:${MUTED}`}>
                      {icon} {s.control}
                    </li>
                  );
                }
                if (s.kind === "communication") {
                  return (
                    <li key={i} style={`font-size:13px;color:${MUTED}`}>
                      {s.label}
                    </li>
                  );
                }
                const args = truncateArgs(s.args);
                return (
                  <li key={i} style={`font-size:13px;color:${TEXT};line-height:1.4`}>
                    <span style="font-weight:600">{s.label}</span>
                    {s.tool ? <span style={`font-size:12px;color:${MUTED}`}> · {s.tool}</span> : null}
                    {args ? (
                      <div style={`font-size:11px;color:${MUTED};font-family:ui-monospace,monospace;word-break:break-all`}>{args}</div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    );
  }

  if (stage === "compose") {
    return compact(<span>Building a plan…</span>);
  }

  if (stage === "step-start") {
    return compact(<span>▶ {json?.label ?? ""}</span>);
  }

  // Unknown stage (e.g. legacy messages from an older build) — render nothing.
  // Return an empty fragment rather than null: Hono JSX throws on a null
  // function-component result ("res.isEscaped").
  return <></>;
}
