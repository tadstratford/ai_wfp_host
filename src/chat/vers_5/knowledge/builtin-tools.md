---
knowledge_name: builtin-tools
description: Built-in workflow tools reference — workflow_start, workflow_end, chat_download, run_MCP
relevant_agents: [build-workflow, modify-workflow]
---

## Built-in Tools

| tool_id | What it does |
|---------|-------------|
| `workflow_start` | Required first node. `type: "start"`. `tool_parameters: {}`. |
| `workflow_end` | Required last node. `type: "end"`. `tool_parameters: {}`. |
| `chat_download` | Embeds a download button in chat. Wire `data` and `filename` in `toolParameters`. Set `inline: "true"` for HTML preview. |
| `run_MCP` | Runs an MCP tool as a step. The executor rewrites MCP nodes to this automatically — the planner does not emit it directly. |

### chat_download wiring

Always pass `data` and `filename` in `toolParameters`:
```
toolParameters: {
  data: "{{result}}",
  filename: "report.html",
  inline: "true"
}
```

The `data` parameter must reference a variable set by a prior step (`{{result}}` is the previous MCP step's output) or a loaded data file. Without this wiring, the download node fails.

### Pausing for user input

If a workflow needs user input mid-run (a confirmation, a few form fields, a decision), a step calls `api.pauseForInput({ markdown, form: { fields: [...] } })`. The hosted app's pause is a node-boundary pause: the form is shown, the workflow halts, the user submits, and the **next** node consumes the form values via `api.getParameter("<field name>")`. Structure steps so the pause is the last statement.

### For AI judgment

For per-row classification or scoring (assign a category, yes/no flag, or score to each row), use the typed Classifier `judge_data` (persist the rows as a `staging_*` data entry first). It is batched, cached, and auditable. Workflows have no free-form LLM step.
