---
name: qbo-analysis
description: Analyze QuickBooks Online data — check connection, review chart of accounts, and run targeted accounting analyses.
---

## Instructions
1. Call the QBO tools directly — they check the connection themselves and return an OAuth link when not connected (show it with `show_message`). There is no need to call `qbo_connect` first.
   - **Sandbox companies:** connect directly — sandbox companies always work without certification.
   - **Real QBO companies (uncertified app):** the user's email must be added as a Test User in the Intuit Developer Portal (My Apps → your app → Development → Test Users). The app owner does this — the QBO user does NOT need admin access to their QBO company. Tell the user: "If this is a real QBO company and the connection fails, your email may need to be added as a Test User in the app's Intuit Developer Portal. The app owner handles this — no changes on your side."
   - **Connection error troubleshooting:** if the OAuth flow fails after authorization, check whether the company is a sandbox (always works) or a production company (requires Test User listing or app certification).
2. Start with the chart of accounts — call `qbo_accounts_list` to understand the account structure before diving in. If the user names an account you don't see there, check `qbo_items_list` (products & services) and `qbo_classes_list` (classes) — it may be tracked as an item or class rather than a GL account.
3. For Profit & Loss / income-statement requests (e.g. "P&L for 2026", "income by month"), use `report_qbo_pnl` — do NOT try to reconstruct it from journal entries. Use `summarize_column_by: "Months"` when the user wants a month-by-month breakdown; it handles companies that reject the Months grouping by assembling per-month columns. Follow it with `chat_download(data="{{result}}", filename="report.html")`. For a quick inline summary (no download), you may use `qbo_pnl_report` and render a markdown table.
4. For balance-sheet requests (e.g. "show me the balance sheet as of Dec 31"), use `report_qbo_bs` with the same `start_date` and `end_date` for an as-of snapshot, then `chat_download(data="{{result}}", filename="report.html")`. For a quick inline summary, use `qbo_balance_sheet`.
5. Run targeted analyses based on the user's question:
   - For misclassifications or naming issues: `qbo_gl_review`
   - For receivables/payables aging: `qbo_ar_ap`
   - For duplicate detection: `qbo_duplicates`
   - For recurring expense gaps: `qbo_recurring_check`
   - For uncategorized entries: `qbo_uncategorized`
6. Summarize findings with specific account names, amounts, and recommended actions. Render tables inline as markdown — only use `chat_download` when the user explicitly asks for a file, and only use `set_param` when the result is large or needs to be referenced across turns.

## Tools needed
- `qbo_accounts_list` — account discovery
- `qbo_items_list` — products & services (Item) lookup when a name isn't a GL account
- `qbo_classes_list` — class lookup
- `report_qbo_pnl` — Profit & Loss (income statement) as a native-QBO-style HTML report (pair with `chat_download`)
- `report_qbo_bs` — Balance Sheet as a native-QBO-style HTML report (pair with `chat_download`)
- `qbo_pnl_report` — Profit & Loss raw rows (for quick inline markdown summaries, incl. month-by-month)
- `qbo_balance_sheet` — Balance Sheet raw rows (for quick inline markdown summaries)
- `qbo_gl_review`, `qbo_ar_ap`, `qbo_duplicates`, `qbo_recurring_check`, `qbo_uncategorized` — targeted analyses
- `chat_download` — deliver the finished report file
- `set_param`, `get_param` — store and retrieve typed results
- `show_message` — present findings to the user
