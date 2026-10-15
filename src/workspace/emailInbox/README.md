# Email Inbox

> Last updated: 2026-10-14

Supabase-backed inbox for inbound email. A user sends or forwards an email to a
per-workspace secret address (`wf-<key>.<secret>@in.workflowpeople.com`) and it is
archived into Supabase tables keyed to that workspace. Emails are **not** written
into the `.wfp` document (unlike LLM logs, which now live in the `.wfp` — see
`src/workspace/logs/`).

## Files

| File | Purpose |
|---|---|
| `types.ts` | `InboundAddress`, `InboundEmail`, `InboundEmailAttachment`, `InboundEmailEntry`. |
| `address.ts` | Inbound address CRUD: `ensureInboundAddress`, `getInboundAddressByKey`, `getInboundAddressByWorkspace`, `revealFullAddress`, `authenticateInboundAddress`, `rotateSecret`, `revokeInboundAddress`, `setAllowlist`, `setEnabled`. |
| `store.ts` | Email archive CRUD: `writeEmail`, `writeAttachments`, `listEmails`, `getEmail`, `listAttachments`, `deleteEmail`. |
| `inboundValidation.ts` | Shared routing + allowlist checks (`resolveInboundEmail`, `parseAddress`, `MAX_INBOUND_EMAIL_BYTES`) used by both the webhook and the test paths. |
| `inboundTest.ts` | `runInboundTest()` — full test pipeline (resolve → allowlists → size → store → headless shadow agent) shared by the dev raw entrance and the session-gated test form. |
| `identity.ts` | The `::email-agent` shadow identity convention + `realId()` (strips the suffix so infra like LLM config resolves the real owner). |
| `index.ts` | Barrel re-export. |

## Address format & security

```
wf-<key>.<secret>@<INBOUND_EMAIL_DOMAIN>
```

- **`key`** — a human-friendly slug of the workspace name (e.g. `acme-corp`),
  uniquified with a short suffix on collision. Resolved from the address *before*
  any workspace is opened. Fallback to a random hex slug when the workspace has no name.
- **`secret`** — short human-friendly authenticator (6 lowercase alphanumeric
  chars). Stored **AES-256-GCM encrypted with `APP_SECRET`** (`secret_encrypted`
  column) so the Settings UI can re-display the full address. Never stored plaintext.

Verification of an inbound email happens in `src/server/inbound/router.ts`:
webhook signature (Svix) → key+secret (`authenticateInboundAddress`, timing-safe)
→ optional sender allowlist. There is no SPF/DKIM check (Resend does not expose it
in the webhook payload).

## Storage (Supabase)

Three tables (see `schema/supabase-schema.sql`), all service-role RLS + `ON DELETE
CASCADE` from `workspaces`:

| Table | Contents |
|---|---|
| `inbound_email_addresses` | One row per workspace inbox: `address_key`, `workspace_id`, `user_id`, `database_id`, `secret_encrypted`, `allowlisted_senders` (JSONB), `enabled`. |
| `inbound_emails` | Flattened columns (`from_email`, `from_name`, `to_address`, `subject`, `date`, `thread_id`, `size_bytes`, `status`) + `entry` JSONB (`textBody`, `htmlBody`, `headers`). |
| `inbound_email_attachments` | `filename`, `mime_type`, `size_bytes`, `content_base64` — stored separately so the email `entry` JSONB stays small. |

`writeEmail` calls the `append_inbound_email` RPC, which inserts idempotently (on
`email_id`) and prunes each workspace to `MAX_EMAILS_PER_WORKSPACE` (200) newest
emails. A `23503` foreign-key error (no `workspaces` row, e.g. disk-backed) is
swallowed so the write degrades silently.

## Size limit

Emails over `MAX_INBOUND_EMAIL_BYTES` (1 MB total — subject + text + html +
attachments) are rejected with a "too large" reply via `sendInboundRejectEmail`.

## Status lifecycle & tooling

Each archived email carries a `status` (`EmailStatus`): `received`, `read`,
`in_progress`, `processed`, `archived`, `deleted` (soft-delete trash), or
`failed` (could not be processed, with an explanation in `fail_reason`).
`updateEmailStatus()` patches it via PostgREST. Emails are processed through the
`emails` MCP capability (`src/capabilities/emails/`), backed by the WFP_API
`api.emails.*` namespace. Outbound sends are recorded in the `outbound_emails`
table via
`sendWorkspaceEmail()` (`outbound.ts`) and listed in the "Sent" view.

### Failed emails

An email is marked `failed` when its workflow cannot process it: a deterministic
tool's failure condition matched (e.g. an invoice date outside every rate range),
the workflow's `workflow_audit` failed, routing found no mapped workflow, or the
workflow itself errored. The `fail_reason` column holds the explanation. The
Emails page "Failed" view lists these emails with their reason and offers Retry
(returns the email to the Inbox as `received`) and Delete.

### Audit (final step of every email workflow)

Every email workflow ends with a `workflow_audit` node (`src/workflow/run/workflow_audit`).
It checks the entire run stream against the workspace rules (`wfp.rules`) and the
rules presented in the workflow description using a single Jev classifier call
(two `noul` + one `choice` question). The status reason is computed in code and is
**fail-closed**: `no_errors` passes; `broke_workspace_rule` / `broke_presented_rule`
fail; and a missing classifier key fails as `audit_unavailable`. When a presented
rule fails (no rule name to report), a single LLM diagnosis pass explains what
happened. A FAILED audit marks the email `failed` with the failed rule name (or the
diagnosis). Machine-checkable failure conditions (e.g. date-in-range) are decided
by deterministic tool code, never by the LLM. No regex/NLP/fallback.

### Status vocabulary (single source of truth)

`EmailStatus` and `EMAIL_STATUSES` live only in `types.ts` (the type is derived
from the array). The `emails` MCP capability and the `email_set_status` /
`email_list` workflow tools import `EMAIL_STATUSES` rather than re-declaring the
list, so adding a status touches one place.

### Authoring a skill for email processing

A user skill maps to a workflow via frontmatter (`workflow:` field). The workflow's
**description** (including its `## Rules`) is what the final `workflow_audit` node
checks the run stream against (as the workflow's "presented rules"):

```markdown
---
name: bill-split-rules-instructions
workflow: bill-split   # the workflow that processes these emails
---

## Instructions
1. … deterministic steps …
```

The **workflow** `bill-split` carries the rules in its description:

```markdown
## Rules
- [deterministic] The invoice date falls within the commitment table's date range used for the split.
- [audit] The outbound email clearly states each fund's amount and share.
```

## Email agent (chat orchestrator, `email` mode)

On inbound arrival the webhook fires `processInboundEmail()` (`agent.ts`) asynchronously
after responding 200. It opens a fresh chat session (`Email: <subject>`) and feeds the
email to `handleMessage(..., mode: "email")` (src/chat/vers_8). The chat orchestrator
runs its Classifier routing → fast path → LLM build loop, where the
model figures out which workflow to run and runs it via the `run_workflow` MCP tool
(passing the inbound `email_id` so the run is linked back to the email). The workflow's
own `send_email` / `workflow_audit` nodes decide the reply and the terminal email status.

- A fresh chat session (`Email: <subject>`) is created per email; the email's
  `session_id` is stored on `inbound_emails` so the "Processed" view links to the run.
- Outbound sends are guarded by the workspace **outbound allowlist**
  (`inbound_email_addresses.outbound_allowlist`), enforced in `sendWorkspaceEmail`.
- Fail-closed: no matching skill, a missing workflow, or a workflow that completes
  without setting a terminal email status marks the email `failed`.
- Workspace resolution: always headless-open the workspace under a synthetic
  shadow identity (`<userId>::email-agent` / `<databaseId>::email-agent`) — the
  inbound path never reuses a logged-in owner's session. Shadow opens are
  plaintext-only; encrypted workspaces and addresses with no `database_id` mark
  the email `failed` (no silent skip). Because the shadow identity has no
  `admin_users` row, LLM config/key lookups strip the suffix via `realId()`
  (`identity.ts`) to resolve the real owner's provider/model/key.
- Guard with `EMAIL_AGENT_ENABLED=false` to disable. Two test surfaces drive the
  same store + agent path without a real Resend webhook, both via
  `runInboundTest()` (`inboundTest.ts`): the dev-only raw entrance (`x-inbound-dev: 1`
  header on `POST /inbound/email`, active when `NODE_ENV` is non-production), and
  the session-gated "Test incoming email" form on the Emails section
  (`/app/emails` → `POST /app/emails/test`, scoped to the active workspace).

## Running a workflow against an email

When a workflow is launched from the Emails page (`POST /app/emails/run-workflow`),
each selected email gets its own session with these parameters pre-seeded (readable
as `{{name}}` templates or `api.getParameter("name")`):

| Parameter | Contents |
|---|---|
| `email_id` | The inbox email id — pass to `email_get` / `email_set_status` / `email_delete`. |
| `email_subject` | Subject line. |
| `email_from` | Sender email address. |
| `email_date` | The email's date. |
| `email_body` | Plain-text body (`textBody`, falls back to `htmlBody`). |
| `email_attachments` | Array of attachment **metadata** — `{ attachment_id, filename, mime_type, size_bytes }` (no base64 content). |
| `__internal_initialInput` | Human-readable summary; `workflow_start` exposes it as `{{userMessage}}`. |

Attachments are metadata-only here. To fetch attachment bytes, use the
attachment download endpoint (`/app/emails/:emailId/attachment/:attachmentId`) or
extend `api.emails.*` / the MCP server with an attachment reader.

## Related

- `src/server/inbound/router.ts` — the public webhook (`POST /inbound/email`).
- `src/shared/email/sendInboundRejectEmail.ts` — the "too large" reply.
- `src/shared/email/sendEmail.ts` — generic outbound send used by the Emails tools.
- `src/workspace/emailInbox/outbound.ts` — sent-email tracking (`sendWorkspaceEmail`, `listSentEmails`).
- `src/workspace/emailInbox/agent.ts` — email agent (`processInboundEmail`) — runs the chat orchestrator in `email` mode.
- email-mode guardrails (`email-guardrails`, `email-processing`) — safety policy selected by the orchestrator in email mode.
- `src/capabilities/emails/` — chat-facing email tools (`send_email`); inbox triage via the WFP_API `api.emails.*` namespace.
- `src/workflow/run/workflow_audit` — final independent audit step.
- `src/capabilities/emails/` — chat-facing email tools.
- `src/ui/pages/app/emailInbox/emailsView.tsx` — the "Emails" shell section (inbound address, read-only Inbox, and the "Test incoming email" form + `POST /app/emails/test` handler).
- `schema/supabase-schema.sql` — table + RPC definitions.
