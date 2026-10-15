---
name: data-account-check
description: Check that transactions in loaded workspace data are coded to the correct account — ask a few yes/no checks over the whole dataset (e.g. are any transactions miscoded?) and report the outcome.
scope: chat
tags: [audit, data, account]
---

## Instructions
1. Locate the data — call `list_data` to find the raw sheet and its normalized `synth_<name>_transactions` / `synth_<name>_accounts` tables.
2. Check the whole table in one call — `check_data` on `synth_<name>_transactions` with `checks: [{ id: "miscoded_account", question: "Are any transactions coded to an account that does not match their memo/description?" }]`.
3. Report the outcome — for each check, state yes/no with the Classifier's confidence and a short reason. Do not list individual rows.
4. Do NOT loop over rows yourself — one `check_data` call covers the whole table.

## Tools needed
- `list_data` — find the loaded data and its normalized tables
- `check_data` — ask a few yes/no checks over the whole dataset with Classifier (Jev)
- `set_param`, `show_message` — store and present findings
