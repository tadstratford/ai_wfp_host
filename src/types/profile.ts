/**
 * Data profile types — the output of the `profile_data` tool (and the shared
 * deterministic engine in `src/data/profile.ts`). A profile is *computed on
 * demand* by the tool; it is not persisted as a document node.
 */

/** Per-column data health. */
export interface ColumnProfile {
  column: string;
  /** inferred type ("number" | "boolean" | "string"), or "unknown" when absent. */
  type: string;
  /** non-blank cell count. */
  nonNull: number;
  /** blank / null cell count. */
  nullCount: number;
  /** distinct non-blank values. */
  distinct: number;
  /** cells whose value does not match the inferred type. */
  typeViolations: number;
}

/** A footing identity, e.g. "Total Expenses = Fund I Expenses + Fund II Expenses". */
export interface FootingCheck {
  /** human-readable identity. */
  label: string;
  /** the column that should equal the sum. */
  leftColumn: string;
  /** the columns that should sum to it. */
  rightColumns: string[];
  /** true when the identity holds for every comparable row (within tolerance). */
  holds: boolean;
  /** rows where the identity was violated. */
  mismatchRows: number;
  /** largest |left − sum(right)| across comparable rows. */
  maxAbsDiff: number;
}

/** An explicit footing the caller asks the profile to check. */
export interface FootingSpec {
  leftColumn: string;
  rightColumns: string[];
}

/** Per-table data profile. */
export interface TableProfile {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
  /** number of rows that are exact duplicates of an earlier row. */
  duplicateRows: number;
  footings: FootingCheck[];
}
