import { Context } from "hono";
import { userManager, type UsageBucket } from "@backend/core/admin/userManager";
import type { User } from "@backend/types";
import providersJson from "@backend/core/llm/llm-providers.json";

/**
 * Usage analytics panel — rendered into #usage-panel on the /app/user screen.
 * Granularity toggle re-fetches via hx-get. Uses the `usage_buckets` RPC and
 * renders an inline-SVG stacked bar chart (no chart lib).
 *
 * Windows are fixed and continuous:
 *   - Daily   → last 30 days
 *   - Monthly → last 12 months
 * Missing days/months are rendered as empty bars.
 */

// ── Model display names (loaded once from llm-providers.json) ────────────────

const MODEL_NAMES: Record<string, string> = {};
{
  const providers = (providersJson as any).providers ?? {};
  for (const p of Object.values(providers) as any[]) {
    for (const m of p.models ?? []) {
      if (m.id && m.name) MODEL_NAMES[m.id] = m.name;
    }
  }
}

const PALETTE = [
  "#e19379", "#788ffe", "#4385f4", "#74a5f7", "#0ea5e9",
  "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Granularity = "day" | "month";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function shortModelName(id: string): string {
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  return id.includes("/") ? id.split("/").slice(1).join("/") : id;
}

function providerOf(id: string): string {
  return id.includes("/") ? id.split("/")[0] : "";
}

/** Canonical bucket key for a timestamptz string (UTC). */
function canonKey(iso: string, g: Granularity): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  return g === "month" ? `${y}-${m}` : `${y}-${m}-${pad(d.getUTCDate())}`;
}

/** Build the continuous window of bucket keys + labels, and the query `since`. */
function buildWindow(g: Granularity): { keys: string[]; labels: string[]; since: string } {
  const now = new Date();
  const keys: string[] = [];
  const labels: string[] = [];

  if (g === "month") {
    const startY = now.getUTCFullYear();
    const startM = now.getUTCMonth() - 11;
    const since = new Date(Date.UTC(startY, startM, 1)).toISOString();
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(startY, startM + i, 1));
      keys.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
      labels.push(`${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`);
    }
    return { keys, labels, since };
  }

  const since = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29),
  ).toISOString();
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29 + i));
    keys.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    labels.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
  }
  return { keys, labels, since };
}

function buildAgg(
  buckets: UsageBucket[],
  granularity: Granularity,
  window: { keys: string[]; labels: string[] },
) {
  const modelTotals: Record<string, { cost: number; tokens: number; requests: number }> = {};
  const byKeyModel: Record<string, Record<string, number>> = {};
  let cost = 0;
  let tokens = 0;
  let requests = 0;

  for (const b of buckets) {
    const m = (modelTotals[b.model] ??= { cost: 0, tokens: 0, requests: 0 });
    m.cost += b.costUsd;
    m.tokens += b.inputTokens + b.outputTokens;
    m.requests += b.requests;

    cost += b.costUsd;
    tokens += b.inputTokens + b.outputTokens;
    requests += b.requests;

    const key = canonKey(b.bucket, granularity);
    (byKeyModel[key] ??= {})[b.model] = b.costUsd;
  }

  const models = Object.keys(modelTotals).sort(
    (a, b) => modelTotals[b].cost - modelTotals[a].cost,
  );

  return {
    keys: window.keys,
    labels: window.labels,
    models,
    modelTotals,
    byKeyModel,
    totals: { cost, tokens, requests },
  };
}

function usd(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const m = raw / base;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return n * base;
}

function fmtAxis(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1) return `$${n.toFixed(0)}`;
  if (abs >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const usagePanelHandler = async (c: Context) => {
  const user = c.get("user") as User;
  const granularity: Granularity = c.req.query("granularity") === "month" ? "month" : "day";

  const window = buildWindow(granularity);
  const buckets = await userManager.getUsageBuckets(user.userId, granularity, window.since, undefined);
  const agg = buildAgg(buckets, granularity, window);

  return c.html(usagePanel(agg, granularity));
};

// ── Render ───────────────────────────────────────────────────────────────────

function segButton(opts: { label: string; active: boolean; granularity: Granularity }) {
  return (
    <button
      type="button"
      hx-get={`/app/api/usage-panel?granularity=${opts.granularity}`}
      hx-target="#usage-panel"
      hx-swap="outerHTML"
      class={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors ${
        opts.active
          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {opts.label}
    </button>
  );
}

function usagePanel(agg: ReturnType<typeof buildAgg>, granularity: Granularity) {
  const H = 120;
  const AXIS_W = 40;
  const TOP = 12;
  const chartW = Math.max(280, Math.min(720, agg.keys.length * 44));
  const step = agg.keys.length > 0 ? chartW / agg.keys.length : 44;
  const barW = Math.max(4, step - 6);
  const maxTotal = Math.max(
    0.01,
    ...agg.keys.map((k) => agg.models.reduce((s, m) => s + (agg.byKeyModel[k]?.[m] ?? 0), 0)),
  );
  const axisStep = niceStep(maxTotal / 3);
  const chartMax = axisStep * 3;
  const ticks = [0, axisStep, axisStep * 2, chartMax];

  return (
    <div id="usage-panel" class="card p-5 space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Usage</h3>
        <div class="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 p-0.5">
          {segButton({ label: "Daily", active: granularity === "day", granularity: "day" })}
          {segButton({ label: "Monthly", active: granularity === "month", granularity: "month" })}
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
          <div class="text-xs text-gray-500 dark:text-gray-400">Spend</div>
          <div class="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{usd(agg.totals.cost)}</div>
        </div>
        <div class="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
          <div class="text-xs text-gray-500 dark:text-gray-400">Requests</div>
          <div class="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{agg.totals.requests.toLocaleString()}</div>
        </div>
        <div class="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
          <div class="text-xs text-gray-500 dark:text-gray-400">Tokens</div>
          <div class="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{agg.totals.tokens.toLocaleString()}</div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <svg
          viewBox={`0 0 ${AXIS_W + chartW} ${TOP + H + 24}`}
          class="text-gray-400 dark:text-gray-500 w-full h-auto min-w-[300px]"
          preserveAspectRatio="xMinYMin meet"
        >
          {ticks.map((t, ti) => {
            const y = TOP + H - (t / chartMax) * H;
            return (
              <g key={ti}>
                <line
                  x1={AXIS_W}
                  y1={y}
                  x2={AXIS_W + chartW}
                  y2={y}
                  stroke="currentColor"
                  stroke-opacity="0.15"
                  stroke-dasharray="3 3"
                />
                <text x={AXIS_W - 6} y={y + 3} text-anchor="end" font-size="9" fill="currentColor">
                  {fmtAxis(t)}
                </text>
              </g>
            );
          })}
          {agg.keys.map((key, i) => {
            let y = TOP + H;
            return (
              <g key={key}>
                {agg.models.map((model, mi) => {
                  const cost = agg.byKeyModel[key]?.[model] ?? 0;
                  const h = (cost / chartMax) * H;
                  y -= h;
                  return (
                    <rect
                      key={model}
                      x={AXIS_W + i * step + 3}
                      y={y}
                      width={barW}
                      height={Math.max(0, h - 0.5)}
                      fill={PALETTE[mi % PALETTE.length]}
                      rx="1"
                    >
                      <title>{`${shortModelName(model)} · ${usd(cost)}`}</title>
                    </rect>
                  );
                })}
                <text x={AXIS_W + i * step + step / 2} y={TOP + H + 15} text-anchor="middle" font-size="10" fill="currentColor">
                  {agg.labels[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div>
        <div class="flex items-center gap-2 mb-2">
          <h4 class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Top models</h4>
          <span class="text-xs text-gray-400 dark:text-gray-500">by spend</span>
        </div>
        <ul class="flex flex-col gap-2">
          {agg.models.map((model, mi) => {
            const t = agg.modelTotals[model];
            const pct = agg.totals.cost > 0 ? (t.cost / agg.totals.cost) * 100 : 0;
            const color = PALETTE[mi % PALETTE.length];
            return (
              <li key={model} class="flex flex-col gap-1">
                <div class="flex w-full items-center gap-2.5">
                  <span class="size-2.5 rounded-full shrink-0" style={`background:${color}`} />
                  <span class="truncate text-sm font-medium text-gray-900 dark:text-white" title={model}>
                    {shortModelName(model)}
                  </span>
                  <span class="truncate text-xs text-gray-400 dark:text-gray-500">{providerOf(model)}</span>
                  <span class="ml-auto shrink-0 text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                    {usd(t.cost)}
                  </span>
                </div>
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div class="h-full rounded-full" style={`width:${pct}%;background:${color}`} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
