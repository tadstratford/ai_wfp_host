/**
 * Deterministic synthesis of structured (array/object) tool arguments.
 *
 * The parameter extractor (`src/chat/extract/extract.ts`) only fills string/number/
 * boolean/enum/date/email params, so a tool like `aggregate_data` — whose
 * `measures` (array of {column, fn}) and `group_by` (array of strings) are
 * required — would always come back "missing". This module turns common
 * phrasings ("sum Amount by Account") into the correct structured values
 * without an LLM call. Anything it can't handle is left to the composer's
 * LLM JSON fill.
 */

/** Normalize a token for fuzzy matching: lowercase, collapse separators. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]+/g, " ").trim();
}

/** Resolve a data-file reference from the request text + inventory. */
export function resolveDataName(
  text: string,
  inventory: { name: string }[],
): string | null {
  if (inventory.length === 0) return null;
  if (inventory.length === 1) return inventory[0].name;

  const t = norm(text);

  // 1) Full normalized name appears verbatim in the request.
  for (const entry of inventory) {
    const n = norm(entry.name);
    if (n.length >= 3 && t.includes(n)) return entry.name;
  }

  // 2) A distinctive token (≥5 chars) from one name appears in the request.
  //    Only return when exactly one entry matches, so we never guess between
  //    multiple files that share a common word like "report".
  const matches = new Set<string>();
  for (const entry of inventory) {
    for (const tok of norm(entry.name).split(" ")) {
      if (tok.length >= 5 && t.includes(tok)) {
        matches.add(entry.name);
        break;
      }
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/** Columns mentioned in `snippet`.
 *  1) Full normalized name (longest first, each match removed so a short name
 *     "Account" doesn't fire inside a longer one "GL Account").
 *  2) A distinctive token (≥4 chars) that appears in the remaining text: map it
 *     to its column; when a token belongs to several columns, prefer the column
 *     whose head noun (last word) is that token — so "Account" resolves to
 *     "GL Account" rather than "Account Description". Genuinely ambiguous tokens
 *     are left unresolved (never guessed). */
export function matchColumnNames(snippet: string, columns: string[]): string[] {
  const t = norm(snippet);
  const found = new Set<string>();

  const sorted = [...columns].sort((a, b) => norm(b).length - norm(a).length);
  let lower = ` ${t} `;
  for (const c of sorted) {
    const n = norm(c);
    if (n.length >= 2 && lower.includes(n)) {
      found.add(c);
      lower = lower.split(n).join(" ");
    }
  }

  const owners = new Map<string, string[]>();
  for (const c of columns) {
    for (const raw of norm(c).split(" ")) {
      const tok = raw.replace(/[^a-z0-9]/g, "");
      if (tok.length < 4) continue;
      const list = owners.get(tok) ?? [];
      if (!list.includes(c)) list.push(c);
      owners.set(tok, list);
    }
  }

  for (const [tok, cols] of owners) {
    if (!lower.includes(tok)) continue;
    const candidates = cols.filter((c) => !found.has(c));
    if (candidates.length === 0) continue;
    if (candidates.length === 1) {
      found.add(candidates[0]);
      continue;
    }
    const head = candidates.filter((c) => {
      const words = norm(c)
        .split(" ")
        .map((w) => w.replace(/[^a-z0-9]/g, ""))
        .filter(Boolean);
      return words[words.length - 1] === tok;
    });
    if (head.length === 1) found.add(head[0]);
  }

  return columns.filter((c) => found.has(c));
}

export type AggFn = "sum" | "count" | "avg" | "min" | "max";

const AGG_FN_PATTERNS: { re: RegExp; fn: AggFn }[] = [
  { re: /\b(?:sum|total|summed|add\s*up)\b/i, fn: "sum" },
  { re: /\b(?:count|how\s+many)\b/i, fn: "count" },
  { re: /\b(?:average|avg|mean)\b/i, fn: "avg" },
  { re: /\b(?:minimum|min)\b/i, fn: "min" },
  { re: /\b(?:maximum|max)\b/i, fn: "max" },
];

export function detectAggFn(text: string): AggFn | null {
  for (const p of AGG_FN_PATTERNS) {
    if (p.re.test(text)) return p.fn;
  }
  return null;
}

/** Columns named after a grouping keyword ("by X", "grouped by X", "per X"). */
export function extractGroupBy(text: string, columns: string[]): string[] {
  const m = text.match(/\b(?:grouped\s+by|group\s+by|by|per|across)\b\s+([a-z][a-z0-9 ,&]*)/i);
  if (!m) return [];
  return matchColumnNames(m[1], columns);
}

export function synthesizeMeasures(
  text: string,
  columns: string[],
  groupBy: string[],
): { column: string; fn: string } | null {
  const fn = detectAggFn(text);
  if (!fn) return null;
  const gbSet = new Set(groupBy.map((g) => g.toLowerCase()));
  const mentioned = matchColumnNames(text, columns);
  const column = mentioned.find((c) => !gbSet.has(c.toLowerCase()));
  // No fallback: never guess a column. A wrong guess (e.g. summing the first
  // column, which may be an ID) produces a silently wrong result.
  if (!column) return null;
  return { column, fn };
}

/** True when the request asks to group ("by X", "grouped by X", "per X"). */
function hasGroupingKeyword(text: string): boolean {
  return /\b(?:grouped\s+by|group\s+by|by|per|across)\b/i.test(text);
}

/**
 * Deterministic synthesis of structured (array/object) params for known shapes.
 * Handles the common "sum/avg/count Column by OtherColumn" aggregation phrase;
 * everything else is left to the composer's LLM fill. Fail-safe: if a grouping
 * was requested but its columns can't be resolved, return nothing rather than a
 * misleading ungrouped total.
 */
export function synthesizeStructuredArgs(
  toolId: string,
  text: string,
  columns: string[],
): Record<string, unknown> {
  if (toolId === "aggregate_data" && columns.length > 0) {
    const groupBy = extractGroupBy(text, columns);
    if (hasGroupingKeyword(text) && groupBy.length === 0) return {};

    // measures is required for aggregate_data — if we can't determine it,
    // bail rather than returning a partial (and unusable) result.
    const m = synthesizeMeasures(text, columns, groupBy);
    if (!m) return {};

    const out: Record<string, unknown> = {};
    if (groupBy.length > 0) out.group_by = groupBy;
    out.measures = [{ column: m.column, fn: m.fn }];
    return out;
  }
  return {};
}
