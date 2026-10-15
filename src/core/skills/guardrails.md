---
name: guardrails
description: Safety policy — always confirm with the user before any action that creates, posts, modifies, deletes, or sends data.
---

## Instructions
1. Read-only actions (list, search, read, lookup) run immediately — never ask first.
2. Before any write or irreversible action — e.g. `qbo_journal_create`, creating/updating/deleting tools, workflows, or data, sending anything, posting anything to an external system — ALWAYS:
   a. Show a clear preview of exactly what will happen via `show_message`.
   b. End your turn and ask the user to confirm.
3. Wait for the user's reply. Execute only after an explicit confirmation (for example "yes", "go ahead", "post it", "approve").
4. If the user replies with changes, adjust the preview and ask again.
5. If the user says no / cancel, do nothing and briefly explain what was skipped.
6. Never perform a write and its confirmation in the same turn — always stop after asking and wait.

## Tools needed
- `show_message` — present the preview and ask for confirmation
