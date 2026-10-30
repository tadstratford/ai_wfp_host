/**
 * Thinking — the vers_11 "thinking" transparency card. Renders the routing,
 * rule-selection, and plan-progress beats as compact inline cards:
 *
 *   classify-options → prompt + candidate skills with probability bars
 *   classify-outcome → the picked skill(s)
 *   rules-options    → prompt + candidate workspace rules with probability bars
 *   rules-outcome    → the applying rules + their enforcement tier
 *   tools            → the tools the plan will use, with their descriptions
 *   compose          → "Building a plan…"
 *   step-start       → "▶ <step label>"
 *
 * The plan checklist itself stays in the right rail; these are the narrative
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

interface ThinkingTool {
  name: string;
  label?: string;
  description?: string;
}

const BRAND = "#3E8DE1";
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

function optionCard(prompt: string, options: ThinkingOption[]) {
  const maxProb = Math.max(0, ...options.map((o) => Number(o.prob) || 0));
  return (
    <div style={`border-top:3px solid ${BRAND};background:#ffffff;border-radius:0 0 8px 8px`}>
      <div style={`padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid ${BORDER}`}>
        {Lightning()}
        <span style={`font-size:13px;font-weight:600;color:${TEXT}`}>{prompt}</span>
      </div>
      <div style="padding:8px 14px 12px">
        {options.length === 0 ? (
          <div style={`font-size:13px;color:${MUTED}`}>No candidates.</div>
        ) : (
          options.map((o, i) => {
            const prob = Number(o.prob) || 0;
            const pct = Math.round(prob * 100);
            const width = maxProb > 0 ? Math.max(4, Math.round((prob / maxProb) * 100)) : 0;
            return (
              <div key={i} style="display:flex;align-items:center;gap:10px;padding:3px 0">
                <span style={`font-size:13px;color:${TEXT};width:170px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>
                  {o.name}
                </span>
                <span style={`flex:1;height:6px;border-radius:9999px;background:${BORDER};overflow:hidden`}>
                  <span style={`display:block;height:100%;border-radius:9999px;background:${BRAND};width:${width}%`} />
                </span>
                <span style={`font-size:12px;color:${MUTED};width:36px;text-align:right`}>{pct}%</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function Thinking({ json }: { json: any }) {
  const stage = json?.stage;

  if (stage === "classify-options" || stage === "rules-options") {
    const options: ThinkingOption[] = Array.isArray(json.options) ? json.options : [];
    const prompt =
      json.prompt ||
      (stage === "rules-options" ? "Figuring out which workspace rules apply…" : "Figuring out what type of problem this is…");
    return optionCard(prompt, options);
  }

  if (stage === "classify-outcome") {
    const chosen = Array.isArray(json.chosen) ? json.chosen : [];
    return compact(
      <span>
        Picked: {chosen.map((s: string, i: number) => (
          <span key={i}>
            {i > 0 ? ", " : ""}
            {code(s)}
          </span>
        ))}
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
            {code(r.name)}
            <span style={`font-size:12px;color:${MUTED}`}> ({r.tier})</span>
          </span>
        ))}
      </span>,
    );
  }

  if (stage === "compose") {
    return compact(<span>Building a plan…</span>);
  }

  if (stage === "tools") {
    const tools: ThinkingTool[] = Array.isArray(json.tools) ? json.tools : [];
    return (
      <div style={`border-top:3px solid ${BRAND};background:#ffffff;border-radius:0 0 8px 8px`}>
        <div style={`padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid ${BORDER}`}>
          {Lightning()}
          <span style={`font-size:13px;font-weight:600;color:${TEXT}`}>Tools</span>
        </div>
        <div style="padding:8px 14px 12px">
          {tools.map((t, i) => (
            <div key={i} style="padding:3px 0">
              <div style={`font-size:13px;font-weight:600;color:${TEXT}`}>
                {t.name}
                {t.label && t.label !== t.name ? <span style={`font-size:12px;font-weight:400;color:${MUTED}`}> — {t.label}</span> : null}
              </div>
              {t.description ? (
                <div style={`font-size:12px;color:${MUTED};margin-top:1px`}>{t.description}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (stage === "step-start") {
    return compact(<span>▶ {json?.label ?? ""}</span>);
  }

  return null;
}
