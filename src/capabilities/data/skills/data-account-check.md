---
name: data-account-check
description: Review loaded workspace data the way an accountant would — run the full review battery (completeness, existence, footing, valuation agreement, classification, cutoff, consistency, no-guessing) and report a red/yellow/green verdict per category. Use for any analyze, review, audit, check, foot, reconcile, or tie-out request over the data.
scope: chat
tags: [audit, data, account, review, reconcile]
---

## Instructions
1. Locate the data — call `list_data` to find the raw sheet and its normalized `synth_<name>_transactions` / `synth_<name>_accounts` tables.
2. Work through **every** category in `## Rules` below, then deliver a **red / yellow / green verdict per category** with its evidence. Cover all eight categories; do not stop after the first finding.
3. **Batch, never fan out.** For any per-entity breakdown, make ONE `aggregate_data` call with `group_by` set to the entity column (e.g. `["Name"]` / `["Account Name"]`). Never make one `aggregate_data`/`get_data` call per entity, deal, or account. A run of calls that differ only in a `filter.value` ("Write off - A", "Write off - B", …) is fan-out and is forbidden.
4. **Reconcile two sources — this is mandatory, not optional.** Whenever the data has (a) a schedule/report keyed on a name column (e.g. `Deal Name`) and (b) a ledger/ICO with a text column that can embed that name (e.g. `Description`, `Name`, or `Account Name`), you MUST reconcile them. First call `list_relationships`; if it returns a link, call `reconcile_relationship` with that `relationship_id`. If it returns no link, do NOT stop — call `reconcile_relationship` anyway with explicit columns (`left` = schedule data name, `right` = ledger data name, `on_left` = the name column such as `Deal Name`, `on_right` = the text column such as `Description`, `kind` = `contains`, `compare_left` = the schedule amount column such as `Total Expenses`, `compare_right` = the ledger amount column such as `Amount`). It returns per-key variances and orphan keys deterministically. Only fall back to `compare_data` when the two tables share an exact key column.
5. Keep the battery to roughly one or two tool calls per category (~10–14 total). As soon as you hold one piece of evidence per category, deliver the verdict table — do not keep paging or re-aggregating.
6. Report only figures that appear in a tool result you received this turn — never reconstruct, estimate, or interpolate a number from memory. When data is missing or unresolved, mark it Red or Yellow and say what is missing; if a figure is not in a tool result, say so instead of writing it.

## Tools needed
- `list_data`, `get_data` — find and read the loaded data and its normalized tables
- `aggregate_data` — footing, cross-footing, net-to-zero checks, per-period totals (one call per question, grouped by the key column)
- `compare_data` — reconcile two tables on an exact shared key (matched / mismatched / missing-on-each-side)
- `list_relationships` — discover the cross-table links (equals/contains) the catalog found
- `reconcile_relationship` — reconcile two tables on a discovered link (embedded key), reporting per-key variance + orphans
- `check_data` — broad yes/no checks over the whole dataset with Classifier (Jev)
- `judge_data` — per-row classification only when a row-level verdict is required
- `set_param`, `show_message` — store and present findings

## Rules
- [deterministic] **Completeness** — every source row/side is present in the book; no missing account, class, item class, transaction date, or period. Use `compare_data` (missing on each side) and `check_data` ("any rows missing a GL Account / class / date?").
- [deterministic] **Existence / orphans** — no rows booked on one side but absent from the other; no duplicate entries; no single asset recorded under two different names (e.g. "Tri-Mack" vs "Project Patriot"). Use `compare_data` (missing-left/right) and `check_data` ("any duplicate or renamed entities?").
- [deterministic] **Footing / cross-foot** — column totals tie to the sum of their rows; subtotals roll up to the grand total; cross-foot (Fund I + Fund II = Total) holds to the cent; no rounding gap. Use `aggregate_data` (sum).
- [deterministic] **Valuation / agreement** — amounts match across two systems/sources (schedule vs ledger vs report); report any variance with its direction and magnitude. Use `list_relationships` to find the link, then `reconcile_relationship` once (per-key variance + orphans).
- [audit] **Classification / allocation** — every transaction is coded to the correct account, entity, fund, and class; any threshold/boundary rule is applied correctly. Use `check_data` / `judge_data` plus the workspace rules.
- [audit] **Cutoff / timing** — transactions fall in the correct period; reversals pair correctly with their originals; dates are sane (e.g. no New Date a year after Dead Date). Use `aggregate_data` grouped by date and `check_data`.
- [deterministic] **Consistency** — clearing/suspense/"to be allocated" accounts net to zero; the same entity/account uses one consistent name everywhere; reversals net correctly. Use `aggregate_data` (net sum) and `check_data`.
- [audit] **No guessing** — estimates, missing values, and unresolved items are flagged (Red/Yellow) and never silently replaced with an assumed value; a value that is computed (+/−/SUM/lookup) is stated as such, and a value that is chosen/classified is labelled as such.
