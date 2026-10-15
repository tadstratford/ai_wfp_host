---
knowledge_name: api-reference
description: Workflow node schema and built-in tool reference for the workflow planner
relevant_agents: [build-workflow, modify-workflow]
---

# Workflow reference (composition model)

Workflows are composed from the existing tool catalog (built-in, native, and MCP
tools). No code is generated.

## Workflow node schema

`workflow.nodes` is a real JSON array. Execution order follows `step_order`
(1-based). There is no `edges` field.

Each node has this shape:

```json
{
  "id": "node-<6 hex>",
  "type": "tool",
  "label": "<short human label>",
  "step_order": <integer, 1-based>,
  "tool_id": "<the tool to run — see below>",
  "tool_parameters": { "<param_name>": "<literal value or {{variable_name}}>" }
}
```

`tool_id` is REQUIRED and must be an exact id from the Available tools (a
built-in, a native tool, or an MCP tool). `type` is a UI hint only — runners
dispatch by `tool_id`, not `type`.

## Reserved built-in tool IDs

| Tool ID           | Purpose                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `workflow_start`  | Required first node of every workflow. `type: "start"`. `tool_parameters`: `{}`.                                              |
| `workflow_end`    | Required last node of every workflow. `type: "end"`. `tool_parameters`: `{}`.                                                 |
| `chat_download`   | Presents a download to the user. `tool_parameters`: `{ data, filename, label?, inline? }`. Inline `"true"` previews in-place. |
| `run_MCP`         | Internal bridge the executor uses to run MCP steps. The planner does not emit it directly — an MCP tool id on a node is routed through it automatically. |

## Variable references

`tool_parameters` values like `"{{green_capital_holdings}}"` mean "use the value
of the parameter named `green_capital_holdings`". A `{{name}}` reference resolves
to one of:

- a loaded data file (by its exact name from the workspace manifest),
- `{{result}}` — the output of the previous MCP step (overwritten on each step),
- `{{userMessage}}` — the text the workflow was launched with.

Never emit a `{{name}}` reference that has no provider.

## MCP tools

MCP tools (QBO, planning, data, judge, etc.) are listed separately in the
"MCP tools" section. To use one, add a node whose `tool_id` is the tool's name
and put its arguments in `tool_parameters` — the executor routes it through
`run_MCP` automatically.
