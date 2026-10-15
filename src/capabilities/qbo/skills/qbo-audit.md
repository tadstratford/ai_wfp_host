---
name: qbo-audit
description: Audit QuickBooks Online journal entries against deterministic and LLM-judged rules. Connect to QBO, fetch journals, evaluate each rule, and produce pass/fail verdicts per entry.
---

## Instructions
1. Connect to QBO — call the QBO tools directly; they check the connection themselves and return an OAuth link when not connected (show it with `show_message`). If not connected, return the OAuth URL and ask the user to connect.
2. Fetch journal entries — call `qbo_journal_entries` to get all entries with full line detail.
3. For each journal entry, evaluate every rule in `## Rules` below:
   - `deterministic` rules must be checked against the entry data directly. Inspect the JSON to verify each condition.
   - `audit` rules require LLM judgment. For entries that pass all deterministic rules but need audit-rule evaluation, use your own judgment based on the entry's description, accounts, and amounts.
4. Track results — record a pass/fail verdict per entry with a specific signal (what failed) and remedy (what to do).
5. Summarize findings — present pass/fail counts grouped by rule, list failed entries with their signals and remedies, and suggest next actions.

## Tools needed
- `qbo_journal_entries` — QBO data access
- `set_param`, `get_param`, `show_message` — store results, display findings

## Rules
- [deterministic] Every journal entry has at least 2 lines.
- [deterministic] Debits equal credits for every journal entry (within rounding tolerance of $0.01).
- [deterministic] Every journal entry has a non-empty TxnDate.
- [deterministic] No journal entry line references an account with "Uncategorized" or "Ask My Accountant" in the name.
- [audit] The journal entry line descriptions are clear enough that a person unfamiliar with the books can understand the purpose of the entry.
- [audit] The accounts debited and credited are appropriate for the transaction described in the line descriptions.
