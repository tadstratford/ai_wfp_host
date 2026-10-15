/**
 * Planning — a lean budget-vs-actual model at "reporting account" grain.
 *
 * Facts are wide rows (one per fiscal year × version × account, 12 period
 * columns) stored in the workspace `data` map under `plan_facts`. The reporting
 * accounts (with the QBO accounts that feed each) live in `plan_dim`. QBO is a
 * feed: its account-by-month amounts are rolled up through the dimension into
 * line-level facts. `null` = no data; `0` = a real zero.
 */

export type Per =
  | "per_1" | "per_2" | "per_3" | "per_4" | "per_5" | "per_6"
  | "per_7" | "per_8" | "per_9" | "per_10" | "per_11" | "per_12";

export const perKey = (n: number): Per => `per_${n}` as Per;

export const PER_KEYS: Per[] = Array.from({ length: 12 }, (_, i) => perKey(i + 1));

export type Kind = "income" | "expense" | "balance";

/** One fact row — all versions (actuals, budget1, Forecast, …) are the same shape. */
export type FactRow = {
  "fiscal year": number;
  version: string;
  account: string;
} & Record<Per, number | null>;

/** A QBO account that feeds a reporting account. `id` makes the join survive a
 *  QBO account rename; `name` is the human/fallback key. */
export interface QboSourceRef {
  name?: string;
  id?: string;
}

/** A dimension source may be hand-edited as a bare name or an { name, id } ref. */
export type QboSource = string | QboSourceRef;

/** The reporting-account dimension (one row per reporting account). */
export interface AccountDim {
  account: string;       // join key to FactRow.account
  kind: Kind;            // income/balance: higher is good; expense: lower is good
  group?: string;        // optional rollup, e.g. "Opex"
  order: number;
  qboSources: QboSource[];
}

export const UNMAPPED = "Unmapped";
