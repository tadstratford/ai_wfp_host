// normalize/vers_1 types — the shape vocabulary (pre-`src/data` shapes module)
// plus the normalization config + output model.

// ── Shape vocabulary (folded in from the former `shapes/` module) ───────────

export type ContinuationMode = "row-below" | "entity-id";

/** A collapsed, flat table: column names + string rows. */
export interface FlatTable {
  columns: string[];
  rows: string[][];
}

/** The active block key while walking rows. */
export interface KeyInfo {
  keyText: string;
  entityKey: string | null;
}

export interface ShapeSpec {
  id: string;
  label: string;
  continuation: ContinuationMode;
  fingerprint?: (grid: string[][]) => boolean;
  isKeyRow?: (row: string[]) => boolean;
  isDataRow?: (row: string[]) => boolean;
  entityKey?: (text: string) => string | null;
  outputColumns: string[];
  mapRow: (key: KeyInfo, row: string[]) => string[];
}

export interface ShapeCandidate {
  specId: string;
  label: string;
  confidence: number;
}

// ── Normalization config ────────────────────────────────────────────────────

export type RowRole =
  | "header"
  | "title"
  | "blank"
  | "section_key"
  | "detail"
  | "continuation"
  | "totals"
  | "footer";

export type ColumnRole =
  | "account"
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "id"
  | "name"
  | "type"
  | "ignore";

export interface NormalizeConfig {
  // engines
  allowJev: boolean;
  allowLlm: boolean;
  jevModel: string;

  // classification
  contextWindowSize: number; // total rows in the window (odd); default 5 = 2 above + 2 below + target
  rowRoleMinConfidence: number;
  deterministicFirst: boolean;
  sampleMaxRows: number; // 0 = all; N = classify first N rows, apply rules to the rest

  // row heuristics (deterministic seed)
  sectionKeyPattern: RegExp;
  balanceForwardPattern: RegExp;
  totalsPattern: RegExp;
  datePattern: RegExp;

  // column role mapping
  columnAliases: Record<ColumnRole, string[]>;
  rowRoles: RowRole[];
  columnRoles: ColumnRole[];

  // output
  outputTables: string[];
  normalizeFks: boolean;
  verifyTables: boolean;
  verifyMinScore: number;
}

// ── Normalized output model ─────────────────────────────────────────────────

export interface NormalizedTable {
  name: string;
  columns: string[];
  columnTypes: Record<string, "number" | "boolean" | "string">;
  rows: Record<string, unknown>[];
  foreignKeys?: { column: string; references: { table: string; column: string } }[];
}

export interface NormalizedDataSet {
  tables: NormalizedTable[];
  config: NormalizeConfig;
  engine: "deterministic" | "jev" | "llm" | "qbo";
  confidence: {
    rowRoles: { row: number; role: RowRole; confidence: number }[];
    tableScores: Record<string, number>;
  };
  unresolved: { row: number; issue: string }[];
}
