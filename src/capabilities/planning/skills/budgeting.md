---
name: budgeting
description: Build and report on a lean budget-vs-actual plan at "reporting account" grain — actuals, budget, and forecast in the workspace planning store.
---

## Instructions
1. The planning store has two workspace `data` entries: **`plan_dim`** (the reporting accounts + the QBO accounts that feed each) and **`plan_facts`** (the numbers). Facts are wide rows — `{ "fiscal year", version, account, per_1..per_12 }` — where `version` distinguishes actuals, budget1, budget2, Forecast, "Latest estimate", etc. `null` = no data; `0` = a real zero. Amounts are natural sign (income +, expense +, cash balance +).
2. **Set up the dimension first.** Call `qbo_accounts_list` to see account names, types, and Ids. Then `plan_dim_upsert` with one entry per reporting account: `{ account, kind: "income"|"expense"|"balance", group?, order, qboSources }`. `qboSources` maps many QBO accounts onto one line (e.g. Salaries + Payroll Taxes + Benefits → "Payroll"). Use `{ name, id }` refs so the join survives a QBO rename; the id is the reliable key. Aim for ~8–12 lines (the key P&L drivers + ending cash).
3. **Load actuals.** `qbo_actuals_flat` returns `{ qboName, qboId, group, period, amount }` per account per month (natural sign). Feed it to `plan_actuals_load` with the items; it rolls accounts through the dimension into `actuals` rows and reports anything `Unmapped` (fix those before reporting — totals must still tie to QBO).
4. **Enter budget / forecast.** `plan_facts_upsert` writes rows for any version. The shape is hand-editable — a finance person's spreadsheet as JSON. For "actuals through May, repeat May for the rest of the year", build a Forecast version that repeats May's values into `per_6..per_12`, then `plan_blend` (actuals through cutover + forecast after) to produce "Latest estimate".
5. **Report.** For a deliverable, render the variance deterministically with `report_plan_variance(fy, base, compare, ...)` → `chat_download(data="{{result}}", filename="budget-variance.html")` — a brand-styled HTML report grouped by Income/Expense/Balance with per-line drill-down to monthly Actual vs Budget detail. For a quick inline summary only, `plan_variance` returns the same rows as JSON to render as a markdown table. Flow accounts sum over the period range; balance accounts (cash) use the through period; Net Income is computed. Default `through` is the last period with actuals, so YTD compares apples-to-apples.
6. Cash is a `balance` line, not a flow — pull month-end bank balances from `qbo_balance_sheet` (or a trial balance filtered to Bank) and load them the same way.

## Tools needed
- `qbo_accounts_list`, `qbo_actuals_flat` — QBO account feed (names + Ids, monthly actuals)
- `plan_dim_upsert`, `plan_dim_get` — reporting-account dimension + mapping
- `plan_facts_upsert`, `plan_facts_get` — write/read facts (all versions)
- `plan_actuals_load` — roll QBO actuals into line-level `actuals`
- `plan_variance`, `plan_blend` — budget-vs-actual report + "Latest estimate"
- `report_plan_variance` — deterministic budget-vs-actual HTML report (pair with `chat_download`)
- `chat_download` — deliver the finished self-contained HTML report
- `save_data`, `get_data`, `set_param`, `get_param` — carry data between steps
- `show_message` — present findings to the user
