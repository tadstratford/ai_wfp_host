---
name: data-handling
description: Work with workspace data files — list, read, transform, and store structured data with WFP typed parameters.
tools: [{"name":"list_data","role":"read workspace data files"},{"name":"get_data","role":"read workspace data files"},{"name":"aggregate_data","role":"group and aggregate a data file (sum/count/avg/min/max)"},{"name":"resolve_data_shape","role":"resolve a raw sheet (json_cells) into a clean flat table"},{"name":"check_data","role":"yes/no checks over the whole dataset with the typed Classifier"},{"name":"compare_data","role":"reconcile two tabular files on shared keys"},{"name":"list_relationships","role":"list discovered cross-table links"},{"name":"reconcile_relationship","role":"reconcile two tables on a discovered link"},{"name":"save_data","role":"persist the staging summary table"},{"name":"report_table","role":"deterministic drill-down HTML report"},{"name":"chat_download","role":"deliver the finished HTML report"},{"name":"set_param","role":"typed state management"},{"name":"get_param","role":"typed state management"},{"name":"show_message","role":"present results to the user"}]
---

## Instructions
1. List available data — call `list_data` to see all loaded files with their types, row counts, and column info.
2. Read before modifying — always call `get_data` to understand the structure before making changes.
3. Use typed parameters — when storing derived data use `set_param` with the correct WFP type (number, json_array, json_object, string, boolean).
4. Preserve provenance — note which data files were used as inputs when creating reports or analyses.
5. Handle errors gracefully — if data is missing or malformed, explain what is wrong and suggest fixes.
6. Deliver a **report** (when the user asks for one, or wants a downloadable analysis) with the deterministic drill-down path, not hand-written HTML: `aggregate_data` to build the summary → `save_data(name="staging_<…>", value="{{result}}", type="json_array")` → `report_table(summary="staging_<…>", details=<source name>, group_by=[<join columns>])` → `chat_download(data="{{result}}", filename="report.html")`. Use markdown tables only for quick inline summaries, not the deliverable.
