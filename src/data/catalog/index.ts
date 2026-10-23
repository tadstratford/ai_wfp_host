// Data catalog — build + persist the load-time schema/relationship index.
//
// `buildDataCatalog` runs deterministic relationship discovery across all loaded
// tabular entries and persists the result. `refineDataCatalogWithJev` is the
// optional second pass: it resolves rename/alias links the containment heuristic
// cannot see (e.g. "Tri-Mack" ↔ "Project Patriot (Tri-Mack)"). It is bounded,
// best-effort, and degrades to the deterministic catalog when no Classifier key
// is available (no-fallbacks: an explicit degrade, not a silent substitute).

import type { WorkspaceSession } from "@backend/core/workspace/WorkspaceSession";
import type { DataEntry, DataCatalog, CatalogTable, CatalogRelationship, CatalogAlias } from "wfp-format";
import { parseCsv } from "@shared/wfp-api/csv";
import { materializeLargeRows } from "../stage";
import { discoverRelationships, coverageScan, candidatePhrases, measureCoverage, type DiscoveryTable } from "./discover";

export { coverageScan } from "./discover";

/** Resolve a data entry into row objects, or null when not tabular. */
function rowsOf(entry: DataEntry): Record<string, unknown>[] | null {
  if (Array.isArray(entry.content_json)) return entry.content_json as Record<string, unknown>[];
  if (entry.content_type === "csv" && typeof entry.content === "string") {
    if (entry.large && entry.header_row != null) {
      return materializeLargeRows(entry.content, {
        headerIndex: entry.header_row,
        keyColumns: entry.key_columns ?? [],
        columns: entry.columns ?? [],
      });
    }
    return parseCsv(entry.content);
  }
  if (entry.content_type === "json_array" && typeof entry.content === "string") {
    try {
      const parsed = JSON.parse(entry.content);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      /* not JSON — fall through */
    }
  }
  return null;
}

/** Collect all loaded tabular entries as discovery inputs. */
const MAX_DISCOVERY_ROWS = 50_000;

export function collectTables(session: WorkspaceSession): DiscoveryTable[] {  const tables: DiscoveryTable[] = [];
  for (const name of session.getDataNames()) {
    const entry = session.getDataEntry(name);
    if (!entry) continue;
    // Materialize even "large" entries (lazily-paged for chat, but fine to read
    // whole for discovery) — the intercompany report is ~1.5k rows and must be
    // included or no cross-file link is ever found. Only skip pathological sizes
    // where O(n·m) containment would be too slow.
    if ((entry.row_count ?? 0) > MAX_DISCOVERY_ROWS) continue;
    const rows = rowsOf(entry);
    if (!rows || rows.length === 0) continue;
    if (rows.length > MAX_DISCOVERY_ROWS) continue;
    const columns = entry.columns ?? Object.keys(rows[0]);
    if (columns.length === 0) continue;
    tables.push({ name, columns, rows, source_filename: entry.source_filename ?? null });
  }
  return tables;
}

/** Build the catalog deterministically from the current loaded data. */
export function buildCatalogTables(tables: DiscoveryTable[]): CatalogTable[] {
  return tables.map((t) => ({
    name: t.name,
    columns: t.columns,
    source_filename: t.source_filename ?? null,
    row_count: t.rows.length,
  }));
}

/** Deterministic pass: build + persist the data catalog. Returns the catalog.
 *  Preserves any Jev-discovered aliases from the prior catalog so a refresh
 *  doesn't wipe the (fire-and-forget) refinement pass. */
export function buildDataCatalog(session: WorkspaceSession): DataCatalog {
  const existing = session.getDataCatalog();
  const tables = collectTables(session);
  const relationships = discoverRelationships(tables);
  const catalog: DataCatalog = {
    tables: buildCatalogTables(tables),
    relationships,
    aliases: existing?.aliases ?? [],
    builtAt: new Date().toISOString(),
  };
  session.setDataCatalog(catalog);
  return catalog;
}

/** Invalidate the persisted catalog (used when data is deleted). */
export function clearDataCatalog(session: WorkspaceSession): void {
  session.setDataCatalog(null);
}

// ── Jev alias refinement (best-effort, bounded) ──────────────────────────────

const MAX_ALIAS_KEYS = 20;
const MAX_ALIAS_CANDIDATES = 5;

/** Token overlap between two strings (for ranking alias candidates). */
function tokenOverlap(a: string, b: string): number {
  const A = new Set((a ?? "").toLowerCase().split(/\W+/).filter((t) => t.length >= 2));
  const B = new Set((b ?? "").toLowerCase().split(/\W+/).filter((t) => t.length >= 2));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

/**
 * Second pass: resolve rename/alias links for left keys the containment pass
 * could not match. Runs one bounded `choice` fan-out via Jev; on any failure the
 * deterministic catalog is left unchanged.
 */
export async function refineDataCatalogWithJev(session: WorkspaceSession): Promise<void> {
  const catalog = session.getDataCatalog();
  if (!catalog || catalog.relationships.length === 0) return;

  let key: string;
  try {
    const { getClassifierKey } = await import("@backend/core/user/getLLMApiKey");
    key = await getClassifierKey(session.userId);
  } catch {
    return; // no Classifier key → keep deterministic catalog (explicit degrade)
  }

  const { askClassifier } = await import("@shared/typesafe/openRouter");
  const tables = collectTables(session);
  const byName = new Map(tables.map((t) => [t.name, t]));

  const newAliases: CatalogAlias[] = [];
  const seen = new Set<string>();
  const state: { relationships: { left: string; right: string; unmatched: string[] }[] } = {
    relationships: [],
  };
  const questions: Record<string, unknown> = {};
  const questionKeys: { id: string; left: string; candidates: string[] }[] = [];

  for (const rel of catalog.relationships) {
    const A = byName.get(rel.left.table);
    const B = byName.get(rel.right.table);
    if (!A || !B) continue;
    const leftValues = Array.from(new Set(A.rows.map((r) => String(r[rel.left.column] ?? "").trim()).filter(Boolean)));
    const rightValues = Array.from(new Set(B.rows.map((r) => String(r[rel.right.column] ?? "").trim()).filter(Boolean)));
    const cov = measureCoverage(A.rows, rel.left.column, B.rows, rel.right.column);
    const matchedSet = new Set(
      [...cov.equals.evidence, ...cov.contains.evidence].map((e) => e.left.toLowerCase()),
    );
    const unmatched = leftValues.filter((v) => !matchedSet.has(v.toLowerCase()));
    if (unmatched.length === 0) continue;

    for (const lv of unmatched.slice(0, MAX_ALIAS_KEYS)) {
      const ranked = rightValues
        .map((rv) => ({ rv, score: tokenOverlap(lv, rv) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ALIAS_CANDIDATES)
        .map((x) => x.rv);
      if (ranked.length === 0) continue;
      const id = `alias:${rel.left.table}.${rel.left.column}:${lv}`;
      if (seen.has(id)) continue;
      seen.add(id);
      state.relationships.push({ left: lv, right: rel.right.table + "." + rel.right.column, unmatched: ranked });
      const criteria: Record<string, unknown> = { none: "None of these is the same entity" };
      for (const rv of ranked) criteria[rv] = `"${rv}" refers to the same entity as "${lv}"`;
      questions[id] = {
        type: "choice",
        instructions: `Which value (if any) refers to the same entity as "${lv}"?`,
        criteria,
      };
      questionKeys.push({ id, left: lv, candidates: ranked });
    }
  }

  if (questionKeys.length === 0) return;

  try {
    const { response } = await askClassifier(state, questions as Record<string, import("@shared/typesafe/types").Question>, { apiKey: key });
    for (const qk of questionKeys) {
      const ans = response.answers[qk.id] as { choice?: string };
      if (!ans || !ans.choice || ans.choice === "none") continue;
      if (!qk.candidates.includes(ans.choice)) continue;
      newAliases.push({ canonical: qk.left, aliases: [ans.choice] });
    }
  } catch {
    return; // Jev unavailable/failed — keep deterministic catalog
  }

  if (newAliases.length === 0) return;
  const merged = { ...catalog, aliases: [...(catalog.aliases ?? []), ...newAliases] };
  session.setDataCatalog(merged);
}
