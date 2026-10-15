# Server

> Last updated: 2026-09-27

HTTP server entry point and infrastructure. Built with Hono on Bun.

## Files

| File | Purpose |
|---|---|
| `index.tsx` | Main server entry. Creates the Hono app, mounts middleware (domain redirect, auth, cache-control, logging, error handling), registers all route groups, runs startup tasks (Supabase verification [skipped in `EDITION=local`], MCP init, share cleanup). |

## Subdirectories

| Directory | Purpose |
|---|---|
| `admin/` | Administrative + data-access layer: `userManager.ts` (single façade over `admin_users` — user CRUD, per-provider LLM keys, credit/usage RPCs), `supabase.ts` (thin PostgREST adapter + `EDITION=local` offline gate), `keystore.ts` (`KEYSTORE` file/postgres), `userPersonaManager.ts`, `skillGroupsService.ts`, `siteVisits.ts`, `personaClaudeTools.ts`, `setupClaudeTools.ts`. |
| `api/` | JSON/partial REST endpoints: `modelList.tsx` (`/app/api/models`), `modelPrefs.tsx` (`/app/api/model-prefs`), `modelInfo.tsx` (`/app/api/model-info` + right-rail), `modelPicker.tsx` (picker modal), `keyForm.tsx` (inline key entry), `llmKeys.tsx` (`/user/llm-keys`), `betaCredit.tsx` (credit card + redeem), `usage.tsx` (usage panel), `capabilitiesPrefs.tsx`, `navPrefs.tsx`, `qboStatus.tsx`. |
| `auth/` | Thin barrel re-export (`userManager`, `supabase`, `getLLMConfigByDatabaseId`, `encrypt`/`decrypt`). The actual auth middleware/session lives in `src/ui/pages/auth/`. |
| `forms/` | Universal form system: `createFormMessage.ts`, `handlers.ts`, `validateFormData.ts`. |
| `inbound/` | Inbound email webhook (`POST /inbound/email`) — signature-verified, allowlist-gated. See `inbound/README.md`. |
| `streaming/` | SSE streaming. `simpleSSE.ts` provides `notifyClients()` for chat/workflow real-time updates. |
| `user/` | User resolution: `getLLMApiKey.ts` (per-provider keys, Classifier key, LLM config), `databaseAccess.ts` (session/workflow/chat-mode context), `getUser.ts`, `getUserProfile.ts`, `getUserDatabases.ts`, `localIdentity.ts` (`EDITION=local` single-user identity), `index.ts` (barrel). |

> `apps/`, `email/`, and `middleware/` are currently **empty** (email actually lives in `src/shared/email/`; middleware is inline in `index.tsx`).

## Request Lifecycle

1. Domain redirect middleware (Render `*.onrender.com` → canonical domain)
2. Auth middleware validates the session (except `/auth`, `/public`, `/inbound`, favicons) — `EDITION=local` short-circuits to a fixed local user
3. Cache-control middleware sets no-cache headers for app routes
4. Logging middleware logs method + URL + timestamp
5. Route matching: `/` → redirect to `/app`, `/auth/*`, `/app/*`, `/sessions/*`, `/user/*`, `/inbound/*`
6. Response is HTML (HTMX fragments) streamed back to browser
7. On error: logged to structured error log, returns 500

## Route Map

| Prefix | Router | Purpose |
|---|---|---|
| `/` | `homeSiteRouter` | Landing / home page |
| `/auth` | `authRouter` | Login, signup, session validation |
| `/app` | `appRouter` | Main application shell and all workspace pages |
| `/sessions` | `sessionsRouter` | Session chat stream, interactions, forms, reports |
| `/user` | `userRouter` | User settings, API keys, secrets, dark mode |
| `/inbound` | `inboundRouter` | Inbound email webhook (public, signature-verified) |

### LLM API Log Route

`GET /app/logs/:logId` — Renders a per-step LLM API call log entry as markdown via `marked`. Accessed from log links embedded in session chat messages. Each log entry captures one HTTP call to the LLM provider: system prompt, messages (with accumulated tool-call context), response text, token usage, tool calls. Logs live **inside the `.wfp` document** (via `WorkspaceSession.appendLog`), capped at 50 entries per workspace.

## Startup Tasks

1. Verify Supabase connection + pre-create admin/test users (skipped in `EDITION=local`)
2. Pre-create `ADMIN_USER`, `TEST_USER`, and `DEV_AUTH_BYPASS_EMAIL` accounts
3. Initialize MCP aggregator (`initMcp()`)
4. Clean up expired workspace shares, then every 6 hours

## Build Output

The server exports a Bun-compatible fetch handler:
```ts
export default {
  port: Number(process.env.PORT) || 3000,
  hostname: "0.0.0.0",
  fetch: (req: Request) => app.fetch(req),
  idleTimeout: 255,
};
```

## Related Modules

- `src/ui/` — All route handlers live alongside their UI components
- `src/mcp/init.ts` — MCP server initialization called during startup
- `src/workspace/shareWorkflow.ts` — Share cleanup called during startup
