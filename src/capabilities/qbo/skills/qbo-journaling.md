---
name: qbo-journaling
description: Post NEW journal entries to QuickBooks Online (balanced debit/credit entries, class/location allocations, reclassifications). Activate ONLY when the user asks to create, post, allocate, or reclassify a journal entry — never for P&L, balance sheet, reports, or analysis (use qbo-analysis for those).
---

## When to use
Only apply this skill when the user is asking to WRITE to QuickBooks — create a journal entry, post an entry, allocate a transaction across classes/locations, or reclassify. For reading (P&L, balance sheet, trial balance, accounts, or any analysis), do not use this skill; qbo-analysis handles those.

## Instructions
1. Check connection — call the QBO tools directly; they check the connection themselves and return an OAuth link when not connected (show it with `show_message`). If not connected, return the OAuth URL and ask the user to connect.
2. Resolve accounts — call `qbo_accounts_list` to get account Ids and names. Accounts on each line may be referenced by QBO account Id or exact name.
3. Resolve tracking (class/location) — if the allocation is by class, call `qbo_classes_list`; if by location, call `qbo_locations_list`. Get the exact class/location names (or Ids) for the split. The user does not need to hand you raw Ids — names work too.
4. Resolve entities (vendor/customer) — if an Accounts Payable line needs a vendor, call `qbo_vendors_list`; if a line needs a customer, call `qbo_customers_list`. Pass the vendor/customer by name (or Id) on that line.
5. Build the entry — assemble the lines the user described (or from a saved workspace parameter) so that total debits equal total credits. Every line needs an account, a posting type (`Debit`/`Credit`), and a positive amount. Attach `class` or `location` (by name or Id) to the lines being split, and a `vendor` (by name or Id) to the Accounts Payable line. Add line descriptions when the user provides them.
6. Confirm balance — before posting, sum debits and credits; if they do not match, ask the user or adjust, never post an unbalanced entry.
7. Confirm with the user — show a preview of the entry (lines, amounts, location/class, vendor) via `show_message` and ask them to confirm before posting. Do not post until they confirm.
8. Post — call `qbo_journal_create` with the transaction date, lines, and any private note / doc number. Show the returned journal entry Id.
9. Verify — call `qbo_journal_entries` to confirm the new entry appears with the expected date and balanced totals.
10. Store the result with `set_param` so the user can reference it later.

## Allocation / Reclassification Journals
When the user asks to allocate an existing transaction (e.g., a bill, invoice, or expense) across classes or locations:
1. Find the source amount first — call `qbo_bills_list` (or `qbo_invoices_list`) and locate the transaction by vendor/customer name and date. Use its total amount and vendor. Never treat a transaction/document number (e.g., a bill "Num" like "1474") as a monetary amount.
2. Apply the split percentages to that total. For "50% Oakland / 50% HQ" on a $900 bill, each destination line is $450.
3. Build the journal as a reclassification:
   - Debit the destination class/location lines for their share of the total.
   - Credit the source line for 100% of the total. "Credit the blank location" means a credit line with NO class/location reference (the amount currently sits unallocated there).
   - The credit total equals the debit total — the account balance is unchanged; only the class/location attribution changes.
4. Attach the vendor (by name) to the source credit line when reclassifying an Accounts Payable bill.

When the allocation is driven by a table (an allocation table of entity × month → % plus a set of amounts to allocate), do NOT compute the split yourself — call `qbo_allocation_compute` with the allocation table, the amounts, the period, the debit account, and the credit account. It computes the balanced lines deterministically (residual to the largest share) and writes them to an interim table (`staging_allocation_lines`). Read that table back with `get_data`, preview it with `show_message`, and post it with `qbo_journal_create` using `lines_source` = `staging_allocation_lines`.

## Tools needed
- `qbo_accounts_list` — account discovery
- `qbo_classes_list`, `qbo_locations_list` — resolve class/location names to Ids for allocations
- `qbo_vendors_list`, `qbo_customers_list` — resolve vendor/customer names to Ids
- `qbo_bills_list`, `qbo_invoices_list` — find the source transaction's actual amount and vendor/customer
- `qbo_allocation_compute` — deterministic table-driven split → balanced lines → interim table
- `get_data`, `list_data` — read the allocation table, amounts, and the computed interim table
- `qbo_journal_create` — post the journal entry
- `qbo_journal_entries` — verify the posted entry
- `set_param`, `get_param` — store and retrieve the entry details
- `show_message` — confirm the post and report the entry Id

## Rules
- Journal entries must balance: total debits equal total credits within $0.01.
- Amounts are always positive; the posting type determines debit vs credit.
- Never post an entry whose accounts are unknown — resolve the account Id first.
- Use `class` for QBO class tracking and `location` for QBO location tracking; do not create sub-accounts for the split.
- Class, location, vendor, and customer references may be supplied by exact name (case-insensitive) or QBO Id.
- Accounts Payable lines usually require a `vendor` reference — attach one by name.
- NEVER use a transaction/document number (Num) as a monetary amount. Amounts come from the underlying transaction total.
- NEVER compute an allocation split yourself when a table is involved — use `qbo_allocation_compute`.
- A "blank location" line means a line with no `location` (and no `class`) — do not invent a location name for it.
