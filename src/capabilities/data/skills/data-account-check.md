---
name: data-account-check
description: Review loaded workspace data the way an accountant would — run the full review battery (completeness, existence, footing, valuation agreement, classification, cutoff, consistency, no-guessing) and report a red/yellow/green verdict per category. Use for any analyze, review, audit, check, foot, reconcile, or tie-out request over the data.
scope: chat
tags: [audit, data, account, review, reconcile]
---

## Instructions
1. Locate the data — call `list_data` to find the raw sheet and its normalized `synth_<name>_transactions` / `synth_<name>_accounts` tables.
2. Run the full review battery — work through **every** category in `## Rules` below, not just the items the user named. Use the tool each category names; do NOT loop over rows yourself (one `check_data` / `compare_data` / `aggregate_data` call covers the whole table).
3. Report a **red / yellow / green verdict per category** with the evidence (the deterministic figure or the Classifier's confidence + reason). Green = verified/ties, Yellow = needs confirmation or estimate-dependent, Red = gap / rule violation / unsupported.
4. Never guess a value — when data is missing or unresolved, mark it Red or Yellow and say what is missing, rather than inventing a figure.

## Tools needed
- `list_data`, `get_data` — find and read the loaded data and its normalized tables
- `aggregate_data` — footing, cross-footing, net-to-zero checks, per-period totals
- `compare_data` — reconcile two tables (matched / mismatched / missing-on-each-side)
- `check_data` — broad yes/no checks over the whole dataset with Classifier (Jev)
- `judge_data` — per-row classification only when a row-level verdict is required
- `set_param`, `show_message` — store and present findings

## Rules
- [deterministic] **Completeness** — every source row/side is present in the book; no missing account, class, item class, transaction date, or period. Use `compare_data` (missing on each side) and `check_data` ("any rows missing a GL Account / class / date?").
- [deterministic] **Existence / orphans** — no rows booked on one side but absent from the other; no duplicate entries; no single asset recorded under two different names (e.g. "Tri-Mack" vs "Project Patriot"). Use `compare_data` (missing-left/right) and `check_data` ("any duplicate or renamed entities?").
- [deterministic] **Footing / cross-foot** — column totals tie to the sum of their rows; subtotals roll up to the grand total; cross-foot (Fund I + Fund II = Total) holds to the cent; no rounding gap. Use `aggregate_data` (sum).
- [deterministic] **Valuation / agreement** — amounts match across two systems/sources (schedule vs ledger vs report); report any variance with its direction and magnitude. Use `compare_data` (mismatches with difference).
- [audit] **Classification / allocation** — every transaction is coded to the correct account, entity, fund, and class; any threshold/boundary rule is applied correctly. Use `check_data` / `judge_data` plus the workspace rules.
- [audit] **Cutoff / timing** — transactions fall in the correct period; reversals pair correctly with their originals; dates are sane (e.g. no New Date a year after Dead Date). Use `aggregate_data` grouped by date and `check_data`.
- [deterministic] **Consistency** — clearing/suspense/"to be allocated" accounts net to zero; the same entity/account uses one consistent name everywhere; reversals net correctly. Use `aggregate_data` (net sum) and `check_data`.
- [audit] **No guessing** — estimates, missing values, and unresolved items are flagged (Red/Yellow) and never silently replaced with an assumed value; a value that is computed (+/−/SUM/lookup) is stated as such, and a value that is chosen/classified is labelled as such.
