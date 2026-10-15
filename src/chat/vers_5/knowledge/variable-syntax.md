---
knowledge_name: variable-syntax
description: Variable wiring syntax — {{variable_name}} resolution order and usage
relevant_agents: [build-workflow, modify-workflow]
---

## Variable Wiring

All variables use one syntax: `{{variable_name}}` — no square brackets, no dollar signs.

Any `toolParameters` value can be:
- `{{variable_name}}` — a workflow variable set by a prior node **or** data from the workspace
- A literal string or number — e.g. `"Rules CSV columns: pattern, category, account_code"`

### Resolution order

When `{{name}}` is resolved at runtime:
1. Check session parameters (set by prior steps, e.g. `{{result}}` from the previous MCP step)
2. Fall back to workspace data (a loaded data file)

Data is auto-parsed: CSV becomes an array of objects, JSON is parsed, text stays as-is. The consuming step receives the parsed data directly.

### Common variables

- `{{userMessage}}` — the user's opening message from `workflow_start`
- `{{result}}` — the output of the previous MCP step (overwritten on each step)
- Any loaded data file name from the workspace manifest

### Column names

Use the EXACT column names from the data files. Check the workspace manifest for the actual columns — don't guess `vendor_name` when the column is `vendor`.
