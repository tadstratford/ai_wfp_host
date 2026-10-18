---
name: qbodemo-journaling
description: Post journal entries to the DEMO QuickBooks company (Acme Fund Services), including shared-services expense allocations across funds (classes). Activate ONLY when the user asks to create, post, allocate, or reclassify a journal entry against the demo company.
---

## When to use
Only apply this skill when the user is asking to WRITE to the demo QuickBooks — create a journal entry, post an entry, or allocate shared-services expenses across the funds. For reading (P&L, balance sheet, accounts, or analysis), use `qbodemo-budgeting` / the `qbodemo_*` read tools.

## Instructions
1. Resolve accounts — call `qbodemo_accounts_list` to get account Ids and names. Accounts may be referenced by Id or exact name.
2. Resolve classes — call `qbodemo_classes_list` to get the fund (class) names and Ids. The demo's classes are the three funds: Alpha Growth Fund LP, Beta Income Fund LP, Omega Real Estate Fund LP.
3. Read the allocation inputs — the user loads an allocation table (fund × month → %) and a shared-services expense CSV. Amounts must come from those tables, never guessed.
4. Follow the workspace allocation rule — read `list_rules` / `get_rule` (the rule is also injected into your context) and apply its method exactly.
5. Compute the lines deterministically — call `qbodemo_allocation_compute` with the allocation table, the amounts file, the month, the debit account (`Shared Services`), and the credit account (`Shared Services Clearing`). It splits the total by the percentages and writes the balanced lines to an interim table (`staging_allocation_lines`). Never do this arithmetic yourself.
6. Confirm with the user — read the interim table (`get_data` on `staging_allocation_lines`) and show a preview via `show_message`, then ask them to confirm before posting.
7. Post — call `qbodemo_journal_create` with the transaction date and `lines_source` = `staging_allocation_lines` (the interim table from step 5). Show the returned journal entry Id.
8. Verify — call `qbodemo_journal_entries` to confirm the new entry appears with the expected date and balanced totals.

## Allocation / Reclassification Journals
When allocating shared-services expenses across the funds by an allocation table:
1. Call `qbodemo_allocation_compute` with the allocation table + expense data + the month. It computes the split deterministically (residual to the largest share) and writes the balanced lines to `staging_allocation_lines`.
2. Debit each fund's `Shared Services` expense line for its share, with `class` = the fund; credit `Shared Services Clearing` (no class) for 100% of the total. The credit total equals the debit total.

## Tools needed
- `qbodemo_accounts_list`, `qbodemo_classes_list` — resolve account + fund (class) names to Ids
- `qbodemo_allocation_compute` — deterministic split → balanced lines → interim table
- `get_data`, `list_data` — read the allocation table, expense CSV, and the computed interim table
- `list_rules`, `get_rule` — read the workspace allocation rule
- `qbodemo_journal_create` — post the journal entry
- `qbodemo_journal_entries` — verify the posted entry
- `show_message` — confirm the post and report the entry Id

## Rules
- Journal entries must balance: total debits equal total credits within $0.01.
- Amounts are always positive; the posting type determines debit vs credit.
- Never post an entry whose accounts or classes are unknown — resolve the Id first.
- NEVER guess amounts — read them from the allocation table and expense data.
- NEVER compute the split yourself — always use `qbodemo_allocation_compute`.
- A clearing line means a line with no `class` — do not invent a class name for it.
