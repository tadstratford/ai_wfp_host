---
name: workflow-build
group: workflow-building
description: Detect a request to create or modify an automated workflow and direct the user to the Make Workflow / Modify Workflow tools (do not build in chat).
tools: [{"name":"show_message","role":"present the link to the user"},{"name":"list_workflows","role":"identify the workflow"},{"name":"get_workflow","role":"identify the workflow"},{"name":"list_data","role":"confirm workspace state"}]
---

## Instructions
1. Detect — when the user wants to create or modify a workflow, do NOT build or edit it in chat.
2. Direct — for a NEW workflow, reply with this exact link:

```html
<a hx-get="/app/make-workflow" hx-target="#main-panel" hx-swap="innerHTML" data-nav-path="/app/make-workflow" class="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white no-underline">Make Workflow</a>
```

3. For changes to an EXISTING workflow, direct the user to the Modify Workflow tool (`/app/modify-workflow/:workflowId`).
4. Stop — do not call `create_workflow`, `add_node`, `update_workflow`, `update_node`, or any other creation/edit tool.

## Rules
- Never create or modify workflows, tools, or nodes in chat — direct users to the Make Workflow / Modify Workflow tools.
