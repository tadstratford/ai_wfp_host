// Data catalog — the load-time schema + relationship/lineage index for loaded
// workspace data. Built deterministically at load (with an optional Jev pass
// for semantic/alias refinement), persisted in the `misc` section of the .wfp,
// and consumed by premade deterministic checks (e.g. reconcile_relationship).

export type RelationshipKind = "equals" | "contains";

export type RelationshipSource = "deterministic" | "jev";

/** A loaded table's schema + provenance ("place of origin"). */
export interface CatalogTable {
  name: string;
  columns: string[];
  source_filename: string | null;
  row_count: number | null;
}

/** A discovered link between two columns across two tables. */
export interface CatalogRelationship {
  id: string;
  kind: RelationshipKind;
  left: { table: string; column: string };
  right: { table: string; column: string };
  /** 0..1 — how strong the evidence for the link is. */
  confidence: number;
  /** 0..1 — fraction of left key values found on the right side. */
  coverage: number;
  source: RelationshipSource;
  /** Sample matched value pairs (left key → a right-side cell containing it). */
  evidence: { left: string; right: string }[];
}

/** A resolved rename: a canonical key plus the aliases that map to it. */
export interface CatalogAlias {
  canonical: string;
  aliases: string[];
}

export interface DataCatalog {
  tables: CatalogTable[];
  relationships: CatalogRelationship[];
  aliases: CatalogAlias[];
  builtAt: string;
}
