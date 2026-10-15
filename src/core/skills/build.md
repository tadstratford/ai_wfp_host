---
name: build
description: Execute plans and user requests in build mode. Never builds workflows in chat — directs users to the Make Workflow tool.
---

## Instructions
1. New workflow — if the user wants to CREATE a new workflow, do NOT build it in chat. Reply directing them to the Make Workflow tool using this exact link:

```html
<a hx-get="/app/make-workflow" hx-target="#main-panel" hx-swap="innerHTML" data-nav-path="/app/make-workflow" class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white no-underline">Make Workflow</a>
```

Do not call `create_workflow`, `add_node`, `plan_workflow`, or `build_workflow`.
2. Existing workflow — for direct changes to an existing workflow, direct the user to the Modify Workflow tool (`/app/modify-workflow/:workflowId`). Do not edit it via MCP CRUD tools.
3. Verify — after running something, check it with the corresponding `get_*` tool.
4. Report — tell the user what happened and how to proceed.

## Tools needed
- `create_rule`, `update_rule`, `get_rule` — workspace rules/preferences (not the workflow's design)
- `list_workflows`, `get_workflow` — read verification
- `run_workflow` — run an existing workflow
- `show_message` — communicate progress and results to the user

## Rules
- Never create or hand-build workflows in chat — direct users to the Make Workflow tool.
- The workflow is the source of truth: edit it directly and keep its description in sync.
- Data-driven logic is deterministic; use the typed Classifier `judge_data` for row-level judgment.
- Never use a fallback, default, or NLP/regex heuristic.
- Every workflow ends with a `workflow_audit` node (it checks the run stream against `wfp.rules` + the workflow description's `## Rules`).
