/**
 * Rule application — the structured spec a rule resolves to, and the result of
 * applying it to data.
 *
 * A rule is resolved (prose → a `RuleSpec`, by the chat LLM when it decides how
 * to route a request) and then applied deterministically by
 * `src/data/ruleApply.ts`. These are tool parameter/result shapes — they are not
 * persisted as a document node.
 */

/** The predicate operators a rule can use (mirrors `src/data/filter.ts`). */
export type RuleFilterOp =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "in"
  | "is_empty"
  | "not_empty";

export interface RuleFilterClause {
  column: string;
  op: RuleFilterOp;
  value?: string | number;
}

/** One outcome of a `classify` rule: the `when` clauses (ANDed) select the rows. */
export interface ClassifyOutcome {
  outcome: string;
  when: RuleFilterClause[];
}

/** A percentage share for a `measure` rule's split. */
export interface MeasureSplit {
  entity: string;
  percent: number;
}

/**
 * The resolved, structured form of a rule. `kind` selects the evaluation:
 *  - `classify` — bucket rows into outcomes (first matching outcome wins).
 *  - `flag`     — surface rows matching `when` with a `reason`.
 *  - `measure`  — split a column's total by percentages (from `split` or a
 *                 `splitTable`), the cross-table allocation case.
 */
export interface RuleSpec {
  kind: "classify" | "flag" | "measure";
  /** table the rule applies to (for `measure`, the amounts table). */
  table?: string;
  /** classify — ordered outcomes; first match wins. */
  outcomes?: ClassifyOutcome[];
  /** classify — outcome for rows that match no outcome. */
  defaultOutcome?: string;
  /** flag / measure — row filter. */
  when?: RuleFilterClause[];
  /** flag — the reason attached to flagged rows. */
  reason?: string;
  /** measure — numeric column to sum and split. */
  amountColumn?: string;
  /** measure — explicit split percentages. */
  split?: MeasureSplit[];
  /** measure — a table holding entity/percent columns (clean shape). */
  splitTable?: string;
  splitEntityColumn?: string;
  splitPercentColumn?: string;
}

export interface RuleClassification {
  outcome: string;
  count: number;
  /** sample rows (capped). */
  rows: Record<string, unknown>[];
}

export interface RuleFlagResult {
  reason: string;
  count: number;
  rows: Record<string, unknown>[];
}

export interface RuleAllocation {
  entity: string;
  total: number;
}

/**
 * The stored result of applying one rule to the current data. `applied: false`
 * records *why* (awaiting data / not expressible / no spec) with a `needs` list,
 * so a rule is never silently skipped.
 */
export interface RuleApplication {
  evaluatedAt: string;
  applied: boolean;
  reason?: string;
  needs?: string[];
  classifications?: RuleClassification[];
  flags?: RuleFlagResult[];
  violations?: RuleFlagResult[];
  allocations?: RuleAllocation[];
  total?: number;
}
