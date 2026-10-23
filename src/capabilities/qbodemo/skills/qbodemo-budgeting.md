---
name: qbodemo-budgeting
description: Build and report on a budget-vs-actual plan against the DEMO QuickBooks company (Acme Fund Services — a fund administrator with three funds as classes). Use ONLY when the qbodemo capability is enabled; never use the live qbo_* tools.
---

## Instructions
1. The planning store has two workspace `data` entries: **`plan_dim`** (the reporting accounts + the demo QBO accounts that feed each) and **`plan_facts`** (the numbers). Facts are wide rows — `{ "fiscal year", version, account, per_1..per_12 }` — where `version` distinguishes actuals, budget1, budget2, Forecast, "Latest estimate", etc. `null` = no data; `0` = a real zero. Amounts are natural sign (income +, expense +, cash balance +).
2. **Set up the dimension first.** Call `qbodemo_accounts_list` to see account names, types, and Ids. Then `plan_dim_upsert` with one entry per reporting account, keyed by `{ name, id }` so the join survives a rename. The demo mapping is one reporting line per P&L account plus ending cash:
   - income: Management Fees (100), Admin Fees (101), Interest Income (102)
   - expense: Salaries & Benefits (200), Professional Fees (201), Technology (202), Office & Occupancy (203), Shared Services (204)
   - balance: Operating Cash (300)
   Do NOT add Accounts Receivable (301), Accounts Payable (302), or Shared Services Clearing (303) — they are not reporting lines.
3. **Load actuals.** `qbodemo_actuals_flat` returns `{ qboName, qboId, period, amount }` per account per month (natural sign). Feed it to `plan_actuals_load` (via `store_to` → `source`, or inline `items`); it rolls accounts through the dimension into `actuals` rows and reports anything `Unmapped` (fix those before reporting).
4. **Enter budget / forecast.** To load an uploaded Excel/CSV budget, call `plan_budget_load(source, version, fiscal_year)` — it maps each row's `Account` column to `account` and its Jan..Dec columns to `per_1..per_12`, then writes the version (e.g. `budget1`). For a hand-built forecast, use `plan_facts_upsert` with fact rows. For a cash forecast, call `qbodemo_cash_balances` (store_to) then `plan_forecast(fy, cutover_per, source)` — it deterministically writes the `Forecast` and `Latest estimate` versions.
5. **Cash is a balance line, not a flow** — pull month-end bank balances from `qbodemo_cash_balances` (a flat `{ period, amount }` feed) and feed them to `plan_forecast`; it projects the remaining months and blends into "Latest estimate".
6. **Report.** For a deliverable, render the variance deterministically with `report_plan_variance(fy, base, compare, ...)` → `chat_download(data="{{result}}", filename="budget-variance.html")`. For a quick inline summary only, `plan_variance` returns the same rows as JSON.

## Tools needed
- `qbodemo_accounts_list`, `qbodemo_actuals_flat`, `qbodemo_balance_sheet` — demo QBO account feed + monthly actuals + cash
- `qbodemo_cash_balances` — flat month-end Operating Cash feed (feeds `plan_forecast`)
- `plan_dim_upsert`, `plan_dim_get` — reporting-account dimension + mapping
- `plan_facts_upsert`, `plan_facts_get` — write/read facts (all versions)
- `plan_budget_load` — load an uploaded Excel/CSV budget into a version
- `plan_actuals_load` — roll demo QBO actuals into line-level `actuals`
- `plan_variance`, `plan_blend` — budget-vs-actual report + "Latest estimate"
- `plan_forecast` — deterministic cash forecast (`Forecast` + `Latest estimate` versions)
- `report_plan_variance` — deterministic budget-vs-actual HTML report (pair with `chat_download`)
- `report_plan_cash_forecast` — deterministic cash-forecast HTML report (pair with `chat_download`)
- `chat_download` — deliver the finished self-contained HTML report
- `save_data`, `get_data` — carry data between steps
- `show_message` — present findings to the user

## Rules
- Use the `qbodemo_*` tools only — never the live `qbo_*` tools.
- Amounts are always positive with natural sign (income +, expense +); variance is actual − budget.
