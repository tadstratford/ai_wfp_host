/**
 * Spec components — the first entries in the page-spec vocabulary.
 *
 * Each is a thin TSX wrapper over class strings already used across the app, so a
 * spec-rendered page is pixel-identical to its hand-written predecessor. They are
 * extracted lazily, only as a converted page needs them (see docs/UI.md / the plan).
 *
 * Components take plain data props only — the render runner (specRunner.tsx) resolves
 * any `{token}` placeholders before these ever see a value.
 */

export interface FpaAccount { unit?: string | null; type?: string }interface FpaReportColumn { label: string; account?: FpaAccount }
interface FpaReportRow { label: string; account?: FpaAccount; kind?: string; values: (number | null)[] }
interface ReportResult { name: string; columns: FpaReportColumn[]; rows: FpaReportRow[] }

/** Eyebrow + title + subtitle. Mirrors the inline `Header` in accountingPage.tsx.
 *  `margin` overrides the wrapper's bottom margin (default `mb-5`). */
export function PageHeader({ eyebrow, title, subtitle, margin }: { eyebrow?: string; title: string; subtitle?: string; margin?: string }) {
  return (
    <div class={margin ?? "mb-5"}>
      {eyebrow && (
        <div class="text-[10px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">{eyebrow}</div>
      )}
      <h1 class="text-2xl font-extrabold tracking-tight text-ink dark:text-white">{title}</h1>
      {subtitle && <p class="text-sm text-ink-500">{subtitle}</p>}
    </div>
  );
}

export interface StatItem {
  label: string;
  value: string;
}

/** Roll-up stat tiles, or a dashed empty-state card when there's nothing to show. */
export function StatTiles({ empty, emptyHint, stats }: { empty?: boolean; emptyHint?: string; stats?: StatItem[] }) {
  if (empty) {
    return (
      <div class="rounded-xl border border-dashed border-ink/[0.12] dark:border-white/[0.12] p-6 text-sm text-ink-500">
        {emptyHint ?? "Nothing here yet."}
      </div>
    );
  }
  return (
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {(stats ?? []).map((s) => (
        <div class="card rounded-lg px-3 py-2.5">
          <div class="text-lg font-bold text-ink dark:text-white">{s.value}</div>
          <div class="text-[11px] text-ink-500">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export interface QuickLink {
  label: string;
  /** /app/* partial loaded into #main-panel. */
  partial: string;
  /** Shell push URL (omitted when there's no hosted workspace id). */
  pushUrl?: string;
}

/** A row of pill links into an area's pages (HTMX into #main-panel). */
export function QuickLinks({ links }: { links?: QuickLink[] }) {
  return (
    <div class="flex flex-wrap gap-2 pt-1">
      {(links ?? []).map((l) => (
        <a
          hx-get={l.partial}
          hx-target="#main-panel"
          hx-swap="innerHTML"
          {...(l.pushUrl ? { "hx-push-url": l.pushUrl } : {})}
          class="text-xs font-semibold text-brand-600 dark:text-brand-300 border border-brand-200 dark:border-brand-800 hover:bg-brand-50 dark:hover:bg-brand-900/20 rounded-lg px-3 py-1.5 cursor-pointer no-underline"
        >
          {l.label} →
        </a>
      ))}
    </div>
  );
}

/** Money/number cell — integer with thousands, negatives in parens, % when the
 *  account's unit is "%". Mirrors the Planning formatter. */
function fmtCell(v: number | null | undefined, acct?: FpaAccount): string {
  if (v == null) return "—";
  if (acct?.unit && acct.unit.trim() === "%") return v.toFixed(1) + "%";
  const neg = v < 0;
  const s = Math.abs(Math.round(v)).toLocaleString("en-US");
  return neg ? `(${s})` : s;
}

/** A report grid: header row + data rows (subtotal/total/formula rows bold),
 *  or an empty/error line. Generic — the empty/error copy comes from props (the
 *  data source decides), so the component stays domain-agnostic. */
export function ReportTable({
  res,
  empty,
  emptyMessage,
  error,
}: {
  res?: ReportResult;
  empty?: boolean;
  emptyMessage?: string;
  error?: string;
}) {
  if (error) return <p class="text-sm text-coral-600 dark:text-coral-300">{error}</p>;
  if (empty || !res) return <p class="text-sm text-ink-500">{emptyMessage ?? "No data."}</p>;

  const heavy = (kind?: string, acct?: FpaAccount) =>
    kind === "subtotal" || kind === "total" || acct?.type === "subtotal" || acct?.type === "formula";

  return (
    <div class="overflow-x-auto card rounded-xl">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-ink/[0.07] dark:border-white/[0.07]">
            <th class="text-left px-3 py-2 font-semibold text-ink-700 dark:text-white/80">{res.rows.some((r) => !r.account) ? "Dimension" : "Account"}</th>
            {res.columns.map((col) => (
              <th class="text-right px-3 py-2 font-semibold text-ink-700 dark:text-white/80 whitespace-nowrap">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {res.rows.map((row) => {
            const bold = heavy(row.kind, row.account);
            return (
              <tr class="border-b border-ink/[0.05] dark:border-white/[0.06]">
                <td class={`px-3 py-1.5 ${bold ? "font-semibold text-ink dark:text-white" : "text-ink-600 dark:text-white/70 pl-5"}`}>
                  {row.label}
                </td>
                {row.values.map((v, i) => {
                  const acct = row.account ?? res.columns[i]?.account;
                  return (
                    <td class={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? "font-semibold text-ink dark:text-white" : "text-ink-700 dark:text-white/80"}`}>
                      {fmtCell(v, acct)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface CardItem {
  title: string;
  desc?: string;
  href: string;
  /** Open in a new tab + show the launch arrow. */
  external?: boolean;
}

/** A bordered link card with a title, a launch arrow, and an optional description. */
export function LinkCard({ item }: { item: CardItem }) {
  return (
    <a
      href={item.href}
      {...(item.external ? { target: "_blank", rel: "noopener" } : {})}
      class="block card rounded-xl p-4 no-underline hover:border-brand-400 dark:hover:border-brand-500 transition-colors"
    >
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-ink dark:text-white">{item.title}</span>
        {item.external && <span class="text-brand-600 dark:text-brand-300 text-sm">↗</span>}
      </div>
      {item.desc && <p class="text-xs text-ink-500 mt-1">{item.desc}</p>}
    </a>
  );
}

/** Responsive grid of LinkCards. `cols` controls the small-breakpoint column count. */
export function CardGrid({ cols, items }: { cols?: number; items: CardItem[] }) {
  const colsCls = cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "";
  return (
    <div class={`grid ${colsCls} gap-3`}>
      {items.map((it) => (
        <LinkCard item={it} />
      ))}
    </div>
  );
}
