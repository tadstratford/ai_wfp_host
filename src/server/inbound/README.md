# Inbound Webhook

> Last updated: 2026-09-04

Public endpoint that receives Resend inbound email webhooks and archives them into
the workspace inbox (`src/workspace/emailInbox/`).

## Endpoint

```
POST /inbound/email
```

Mounted **before** the auth middleware in `src/server/index.tsx` and whitelisted
there (`path.startsWith("/inbound")`). The request is authenticated by a Svix
signature, not by a user session.

## Request flow

1. **Verify signature** — Resend signs every webhook with the `RESEND_WEBHOOK_SECRET`
   (Svix format: headers `svix-id`, `svix-timestamp`, `svix-signature`). `verifySignature`
   recomputes `HMAC-SHA256(secret, "<id>.<timestamp>.<rawBody>")` and compares
   timing-safe, accepting either the raw secret or its base64-decoded form. Non-2xx
   (401) on failure.
2. **Parse envelope** — the payload is `{ type, data }`. Only `type === "email.received"`
   is processed; everything else returns 200.
3. **Resolve address** — `data.to` and `data.received_for` are scanned for a
   `wf-<key>.<secret>@…` address; `authenticateInboundAddress` validates key + secret
   (timing-safe) and checks `enabled`.
4. **Allowlist** — non-empty `allowlisted_senders` requires the sender `from` email to
   be present; otherwise the email is dropped silently.

Steps 3–4 (plus the sender parse and the fail-closed server inbound allowlist) are
implemented by `resolveInboundEmail()` (`src/workspace/emailInbox/inboundValidation.ts`)
so the webhook and the test paths share one source of truth.
5. **Fetch body + attachments** — the webhook carries metadata only, so the router
   calls the Resend Receiving API:
   - `GET /emails/receiving/{email_id}` → `text`, `html`, `headers`, `attachments[]`
   - `GET /emails/receiving/{email_id}/attachments/{attachment_id}` → `{ download_url }`
   - `fetch(download_url)` → raw attachment bytes → base64.
6. **Size cap** — if subject + bodies + attachment sizes exceed 1 MB, reply to the
   sender with `sendInboundRejectEmail` and store nothing.
7. **Store** — `writeEmail` + `writeAttachments` (idempotent on `email_id`).

Dropped emails (bad address/secret, not allowlisted, unparseable) return **200** so
Resend does not retry; only an invalid signature returns 401.

## Environment variables

| Variable | Purpose |
|---|---|
| `RESEND_WEBHOOK_SECRET` | Svix signing secret (from the Resend webhook details page). Unset → all webhooks rejected. |
| `RESEND_API_KEY` | Needed to fetch email body + attachment content from the Resend Receiving API. |
| `INBOUND_EMAIL_DOMAIN` | Domain for inbound addresses (default `in.workflowpeople.com`). |

## Transport seam

Signature verification and payload parsing are isolated in this file so an IMAP
poller can replace Resend later without touching the storage layer
(`src/workspace/emailInbox/`).

## Email agent trigger

After storing an email (step 7), the webhook fires `processInboundEmail()`
(`src/workspace/emailInbox/agent.ts`) asynchronously — the email becomes a user
message run through the chat orchestrator in `email` mode. Set
`EMAIL_AGENT_ENABLED=false` to disable. The agent **always** opens the workspace
headlessly under a `::email-agent` shadow identity (it never reuses a logged-in
owner's session), so the inbound path is fully session-independent. LLM
provider/model/key resolution strips the shadow suffix via `realId()`
(`src/workspace/emailInbox/identity.ts`) to reach the real owner's config.

## Dev raw entrance (local testing)

For local testing without a real Resend webhook (i.e. whenever `NODE_ENV` is
unset / non-production), `POST /inbound/email` with header `x-inbound-dev: 1`
and an inline JSON body is processed by the same pipeline — address resolution →
workspace allowlist → server allowlist → size → headless shadow agent — skipping
only the Svix signature and the Resend body fetch:

```
curl -X POST http://localhost:3000/inbound/email \
  -H "content-type: application/json" \
  -H "x-inbound-dev: 1" \
  -d '{"from":"sender@example.com","to":"wf-<key>.<secret>@in.workflowpeople.com","subject":"hi","text":"body"}'
```

It returns a JSON verdict (`accepted`, `dropReason`, `checks[]`, and on success
`emailId`/`status`/`sessionId`/`failReason`) instead of the silent 200 the
production webhook returns. This raw entrance is **dev-only** (never active when
`NODE_ENV=production`).

## In-app test form (production-safe)

The Emails section (`/app/emails`) has a "Test incoming email" form that runs the
same pipeline via the session-gated `POST /app/emails/test` route. Unlike the raw
entrance above, it requires a logged-in user with the workspace open and is
scoped to the active workspace (it will not trigger another workspace's agent).
Both paths share `runInboundTest()` (`src/workspace/emailInbox/inboundTest.ts`).
The form accepts attachments (`multipart/form-data`), which are stored base64 and
fed to the agent as metadata, matching the webhook; the 1 MB total cap includes
attachment bytes.
