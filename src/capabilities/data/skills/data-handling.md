---
name: data-handling
description: Work with workspace data files — list, read, transform, and store structured data with WFP typed parameters.
---

## Instructions
1. List available data — call `list_data` to see all loaded files with their types, row counts, and column info.
2. Read before modifying — always call `get_data` to understand the structure before making changes.
3. Use typed parameters — when storing derived data use `set_param` with the correct WFP type (number, json_array, json_object, string, boolean).
4. Preserve provenance — note which data files were used as inputs when creating reports or analyses.
5. Handle errors gracefully — if data is missing or malformed, explain what is wrong and suggest fixes.
6. Deliver a **report** (when the user asks for one, or wants a downloadable analysis) with the deterministic drill-down path, not hand-written HTML: `aggregate_data` to build the summary → `save_data(name="staging_<…>", value="{{result}}", type="json_array")` → `report_table(summary="staging_<…>", details=<source name>, group_by=[<join columns>])` → `chat_download(data="{{result}}", filename="report.html")`. Use markdown tables only for quick inline summaries, not the deliverable.

## Tools needed
- `list_data`, `get_data` — read workspace data files
- `aggregate_data` — group and aggregate a data file (sum/count/avg/min/max)
- `resolve_data_shape` — resolve a raw sheet (json_cells) into a clean flat table
- `check_data` — ask a few yes/no checks over the whole dataset with the typed Classifier
- `save_data` — persist the `staging_*` summary table before the report
- `report_table` — deterministic drill-down HTML report from a summary + detail table
- `chat_download` — deliver the finished self-contained HTML report
- `set_param`, `get_param` — typed state management
- `show_message` — present results to the user
