---
knowledge_name: email-tools
description: How to build workflows that process inbound emails — seeded inputs, native email tools, fail-closed data-driven rules.
relevant_agents: [build-workflow]
---

## Email Workflows

Email workflows process an inbound email that arrived at the workspace inbox. The
email adapter (`src/workspace/emailInbox/agent.ts`) seeds these parameters for the
run — wire them as `{{name}}` into a node's `tool_parameters`:

- `email_id` — the inbox email id (pass to `email_get` / `email_set_status`)
- `email_subject` — subject line
- `email_body` — plain-text (falls back to HTML) body
- `email_from` — sender address
- `email_date` — the email's date
- `email_attachments` — array of `{ attachment_id, filename, mime_type, size_bytes }` (metadata only; no base64 content)

### Native email tools (wire these as nodes)

| tool_id | Inputs | Outputs |
|---------|--------|---------|
| `email_get` | `email_id` | `email`, `body` |
| `email_list` | `status?`, `limit?` | lists inbox emails |
| `email_set_status` | `email_id`, `status`, `reason?` | marks `processed` / `failed` / `archived` |
| `send_email` | `to`, `subject`, `body`, `html?`, `reply_to?`, `cc?`, `attachment_ids?`, `attachment_filename?`, `attachment_content?`, `draft?` | `result`, `success` |
| `email_delete` | `email_id` | deletes (avoid unless asked) |
| `workflow_audit` | (none) | final fail-closed audit — one Jev classifier call over the run stream vs `wfp.rules` + the workflow description |

`send_email` forwards the source email's attachments by passing `attachment_ids`
(a JSON array of ids — e.g. the `attachment_id`s from `email_attachments`).

### Replying with the report (the adapter does it — not the workflow)

The workflow is **trigger-agnostic**: it produces a report and ends with
`workflow_audit` — it does NOT send email. The email adapter
(`src/workspace/emailInbox/agent.ts`) handles the reply:

- After the run it reads the workflow session's report (the `chat_download`
  step's rendered HTML) and the `workflow_audit` verdict.
- On a **pass** it emails the report back to the sender — inline as the HTML
  body and attached as `report.html` — so the recipient never has to open the
  workflow session.
- On a **failed** (or missing) verdict it marks the email `failed` and sends
  nothing — **a failed run never emails out its output.**

So an email-triggered workflow ends with `chat_download` (deliver the report)
then `workflow_audit`. It must not contain a `send_email` node.

### Data-driven, fail-closed (no hardcoding, no fallback)

- Domain values — rates, percentages, splits, thresholds, lookups — come from
  workspace data (a data file in the Data section), read at run time by wiring
  the data file's name as a `{{dataFileName}}` reference. **Never hardcode them**.
- When a required value is missing — no matching data row for the invoice's
  year/period, or a total that cannot be found — the workflow must **fail**, not
  fall back to a default or guess. Emit a failure (an error status or
  `email_set_status` with `failed` + reason) that the adapter surfaces.

### Contract

- The workflow is trigger-agnostic: it reads the seeded `email_*` params and
  workspace data, does its work, and emits a report (via `chat_download`) — it
  does NOT send email or set email status itself.
- The email adapter sends the reply (report inlined + attached) only after a
  passing `workflow_audit`; a failed run never emails out. It also sets the
  terminal email status (`processed` / `failed`).
- Every email workflow ends with a `workflow_audit` node. The audit checks the
  entire run stream against the workspace rules (`wfp.rules`) and the rules
  presented in the workflow description via a single Jev classifier call. A
  FAILED audit marks the email `failed`; the failed rule name is recorded on the
  audit message.
