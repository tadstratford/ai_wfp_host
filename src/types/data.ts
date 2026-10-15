import type { EncryptionEnvelope } from "./encryption";

export type ContentType =
  | "csv"
  | "json_array"
  | "json_object"
  | "json_cells"
  | "text";

export interface DataEntry {
  content: string | EncryptionEnvelope;
  content_type?: ContentType;
  content_json?: unknown;
  columns?: string[];
  row_count?: number;
  source_filename?: string | null;
  loaded_at?: string;
  edited_at?: string | null;
  group?: string;
  /** inferred column types (column name → "number" | "boolean" | "string"). */
  column_types?: Record<string, string> | null;
  /** detected header row index (0-based). */
  header_row?: number | null;
  /** true when the file was too large to materialize typed rows (lazy paging). */
  large?: boolean;
  /** columns that carry the entry key (forward-filled on continuation lines). */
  key_columns?: string[] | null;
  /** candidate interpretations (shapes) detected at load; the user picks one in chat. */
  shape_candidates?: { specId: string; label: string; confidence: number }[] | null;
  /** chosen shape id, set once the user resolves an interpretation. */
  resolved_shape?: string | null;
  /** names of normalized child tables produced by the normalize pipeline. */
  normalized_tables?: string[] | null;
}
