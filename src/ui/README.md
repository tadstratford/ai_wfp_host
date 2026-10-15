# UI

> Last updated: 2026-09-07

Browser-rendered user interface. React/JSX components rendered server-side via Hono's JSX support, delivered as HTMX fragments. There is no client-side framework — HTMX handles all interactivity.

## Layout model: two shells + partials

The app renders **two full-page HTML shells**, and everything inside them is an HTMX partial swapped into a single content region.

| Shell | Rendered by | URL(s) | Content target |
|---|---|---|---|
| **Firm shell** | `renderFirmShell` (`pages/app/firm/index.tsx`) | `/app/workspaces` | `#firm-panel` |
| **Workspace shell** | `renderShell` (`pages/app/workspace/shellPage.tsx`) | `/app/overview`, `/app/chat`, `/app/data`, `/app/rules`, `/app/privacy`, `/app/make-workflow`, `/app/make-rule`, `/app/modify-workflow/:workflowId` | `#main-panel` |

- The **firm shell** is the company-level "picker" page. Its tabs (Clients / Firm Skills / Access / Settings) are section swaps into `#firm-panel`, with `hx-push-url` and hash anchors (`#firm-skills`, `#firm-access`, `#firm-settings`). Legacy tab routes (`/app/workspaces/skills`, `/access`, `/settings`) redirect to these anchors.
- The **workspace shell** is the client workspace page (firm bar → client identity → section nav → `#main-panel`). Its section nav swaps `#main-panel`.

### Dual-mode handlers

`shellPage(activeKey, handler, initialPath?)` (`workspace/shellPage.tsx`) and `firmShellPage(activeKey, handler)` (`firm/index.tsx`) are the single entry point for both full-page loads and HTMX section updates:

- **`HX-Request: true`** → return only the partial, plus an `HX-Push-Url` header so the browser URL updates without a reload.
- **Direct load** → render the full HTML shell, whose `<main>` element lazy-loads the section via `hx-get={initialPartial} hx-trigger="load" hx-swap="innerHTML"`.

`/app/chat` is special-cased in `workspaceShellChat`: `?session_id`/`?action` routes to `sessionViewHandler`, otherwise `chatPanelView`.

## Truly-new pages vs section updates

**Full pages** render a complete `<html>` shell on direct navigation:

| Route | Handler | Shell |
|---|---|---|
| `/app/workspaces` | `firmShellPage("clients", firmClientsView)` | Firm |
| `/app/overview` | `shellPage("overview", workspacePageView)` | Workspace |
| `/app/chat` | `workspaceShellChat` | Workspace |
| `/app/data` | `shellPage("data", dataPanelView)` | Workspace |
| `/app/rules` | `shellPage("rules", rulesPanelView)` | Workspace |
| `/app/privacy` | `shellPage("privacy", privacyPanelView)` | Workspace |
| `/app/make-workflow` | `shellPage("make", makeWorkflowView)` | Workspace |
| `/app/make-workflow/start` | `startInterview` (interview step 2) | Workspace |
| `/app/make-workflow/interview` | `interviewStep` (interview answer) | Workspace |
| `/app/make-workflow/interview/finalize` | `finalizeInterview` (→ review) | Workspace |
| `/app/make-rule` | `shellPage("rules", makeRuleView)` | Workspace |
| `/app/modify-workflow/:workflowId` | `shellPage("overview", modifyWizardView)` | Workspace |
| `/app/run/:workflowId` | `workflowRunPanel` (dual-mode — renders shell on direct nav) | Workspace |
| `/app/logs/:logId` | `logDetailView` | none (standalone) |
| `/app/account` | `accountStandaloneView` (usage + credits, no workspace required) | none (standalone) |

**Section updates** are partials swapped into `#main-panel` / `#firm-panel` (never a full shell):

- `/app/session` — `sessionViewHandler`; returns a spinner that cascades to a `/sessions/*` partial.
- `/app/workspace` — `workspacePageView` (workflows board partial).
- `/app/view/:workflowId` — `workflowViewPanel`.
- `/app/history/:workflowId` — `workflowHistoryHandler`.
- `/app/workflow/:workflowId/edit` — `workflowEditView` (two-panel live workflow + chat).
- `/app/overview-glassbox`, `/app/overview-genui` — overview sub-sections.
- `/app/data/list`, `/app/data/edit/:name` — data panel sub-views.
- `/app/rules/:name` — rule detail partial (view/edit).
- Firm tab partials: `/app/workspaces/list`, `firmSkillsView`, `firmAccessView`, `firmSettingsView`.
- All `/sessions/*` routes — see below.

**Modals** load into `#modal-container` (a hidden fixed overlay shown via `hx-on--after-swap`):

- Workspace lifecycle: `newWorkspaceModal`, `openWorkspaceModal`, `deleteWorkspaceModal`, `settingsModalView`, `saveAsModal`.
- `workflowModalView`, `workspaceChatModalView`, `dataEditModalHandler`, `modelPickerHandler`, `keyFormHandler`.

**Mutations** (POST/DELETE) return a targeted partial to swap into `#main-panel` (e.g. re-render the workflows board via `workspacePageView`) or `c.text("")` for fire-and-forget actions. No `HX-Refresh` full reloads.

## HTMX conventions

- **Section nav**: `hx-get={href}` + `hx-target="#main-panel"` (workspace) or `hx-target="#firm-panel"` + `hx-push-url` (firm) + `hx-swap="innerHTML"`.
- **URL pushes**: done server-side via the `HX-Push-Url` header in dual-mode handlers, or client-side via `hx-push-url` on links that point at a different section. `shellUrls.ts` centralizes the URLs (`shellChatUrl`, `shellChatListUrl`, `shellWorkflowsUrl`). Note `shellWorkflowsUrl` currently returns `/app/overview`, so opening a workflow card keeps the browser on `/app/overview`.
- **Cascading lazy loads**: a handler returns a spinner `<div>` whose `hx-get="…" hx-trigger="load" hx-swap="innerHTML"` fetches the real content on arrival. Used by `sessionViewHandler` (→ `/sessions/view` / `/sessions/start` / `/sessions/todo-start`), workflow run, run history, and the overview Glass Box.
- **Layout columns**: `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]` (workflows board + right rail), `grid-cols-1 lg:grid-cols-2` (workflow edit two-panel). Right rail collapses below `lg`.
- **Triggers**: `hx-trigger="load"` (lazy load), `hx-trigger="change"` (group input auto-save), default `click`/form submit otherwise.
- **Responsive**: Tailwind `sm`/`md`/`lg` breakpoints; the mobile nav drawer is driven by `public/js/workspaceShell.js` (`#ws-nav`, `#ws-nav-backdrop`), scoped to the workspace shell so it doesn't conflict with legacy `navHelpers.js` popstate handling.
- **Out-of-band / refresh**: `hx-swap-oob` is available but rarely used; mutating handlers re-render and swap the affected partial (no `HX-Refresh` full reloads).

## Authentication & Access

### Session & user context

- **Session cookie** `wfp_session` (`pages/auth/session.ts`): HMAC-SHA256-signed `userId`, 7-day expiry, `httpOnly`, `secure` in production, `SameSite=Lax`. Signed with `APP_SECRET` (required — the server refuses to start without it).
- **`validateUser(c)`** (`pages/auth/getValidUser.ts`) runs in the server middleware: reads the cookie → `loadUserContextByUserId` → sets `c.get("user")`. No valid session → dev bypass (if enabled) else `createUnauthenticatedUser()`.
- **User context** (`src/workspace/context/userContext.ts`) is "solo edition": every authenticated user gets full authority (`isAdmin: 1`, `Designer`/`Approver`/`Admin`). Loaded via `loadUserContext` (by provider id), `loadUserContextByUserId`, or `loadUserContextByEmail`.

### Login methods (`/auth`, `pages/auth/`)

| Method | Route(s) | Auth ID |
|---|---|---|
| Google OAuth (auth-code flow) | `/auth/google`, `/auth/callback/google` | `google_{id}` |
| Magic link (Resend email, 15-min signed token) | `POST /auth/magic-link`, `/auth/magic-link/verify` | `email_{email}` |
| Password (`AUTH=password`; bcrypt hash on `admin_users.password_hash`) | `POST /auth/password` | `email_{email}` |
| Dev login backdoor (non-prod only) | `/auth/dev-login` | `dev_{email}` |
| Dev auth bypass via env (`TEST_USER` / `DEV_AUTH_BYPASS_EMAIL` / `DEV_AUTH_BYPASS`, non-prod only) | middleware-level in `validateUser` | n/a |
| QBO OAuth (connect QuickBooks to the active workspace/client) | `/auth/qbo`, `/auth/callback/qbo` | n/a |

The login page (`pages/auth/loginPage.tsx`) renders every configured method: Google (when `GOOGLE_CLIENT_ID` is set), password (always), and magic link (when `RESEND_API_KEY` is set).

All logins funnel through `loadUserContext` → `setSession` → redirect `/app`. `/auth/logout` closes the active WorkspaceSession, clears ephemeral data, clears the cookie, and redirects to `/auth/login`.

### Middleware & gating (`src/server/index.tsx`)

- **Mount order**: static `/public` + favicon, `/auth`, `/inbound` (all **before** the auth middleware) → auth middleware → cache-control (`no-store` except `/public` and `/auth`) → logging → routers.
- **Auth middleware**: whitelists `/auth`, `/public`, `/api/contact`, `/inbound`, favicons. Unauthenticated + non-whitelisted → redirect `/auth/login` (HTMX gets `HX-Redirect` + 401).
- **Session gate** (`pages/app/router.tsx`): `/app/workspaces`, `/app/account`, workspace lifecycle, sharing, and the `/app` front door are ungated; everything else requires an active `WorkspaceSession`, else redirects to `/app`.

### Access control

- **Solo mode**: authority enums exist but are hardcoded to max for authenticated users — no per-user role enforcement in the UI.
- **Firm Access tab** (`firm/index.tsx`): server-level email allowlists — "Can email in" (inbound senders) and "Can be emailed" (outbound recipients). Empty = deny all. Managed at `/app/workspaces/access/*`.
- **Workspace sharing** (`sharePanel.tsx`): per-workspace grants by email. Only **plaintext** (non-encrypted) workspaces can be shared; invitees open the owner's live workspace read/write. Invite/revoke at `/app/workspaces/:id/share/*`; invitee open at `/app/shared-workspace/:workspaceId/open`.
- **Inbound email webhook** (`server/inbound/router.ts`, `POST /inbound/email`): public, Svix/Resend signature-verified, then key+secret authenticated via the recipient address, then server-level inbound allowlist (fail-closed). Archive-only; optionally triggers the headless email agent.

## Subdirectories

| Directory | Purpose |
|---|---|
| `components/` | Reusable UI components: `dataGrid`, `workflowModal`, `spec/`, `logo`. |
| `pages/` | Page-level route handlers and templates. Each subdirectory corresponds to a URL prefix. |
| `templates/` | Higher-level UI templates: `entity-manager`, `account-table`. |

## Page Structure (`pages/`)

| Directory | Route Prefix | Purpose |
|---|---|---|
| `home/` | `/` | Landing page and marketing pages. |
| `auth/` | `/auth` | Login page + auth handlers: Google OAuth, magic link, QBO OAuth, dev login, logout, session cookie (see "Authentication & Access"). |
| `app/` | `/app` | Application shells (firm picker + workspace), workflows, data, skills, privacy, sharing. |
| `sessions/` | `/sessions` | Chat stream, interactive forms, reports, delete/export. Partials loaded into the workspace shell via `/app/session`. |
| `user/` | `/user` | API-only: dark-mode toggle, secrets CRUD (`/user/secrets`), LLM provider keys (`/user/llm-keys`). |

### `pages/app/` Subpages

| File/Dir | Purpose |
|---|---|
| `page.tsx` | `GET /app` redirector — routes to the workspace shell overview or the firm picker; maps legacy `?panel=` params. |
| `router.tsx` | App route definitions (ungated picker/lifecycle routes, then a session gate, then section/partial/modal/mutation routes). |
| `firm/index.tsx` | Firm shell (`renderFirmShell`) + firm tabs: Clients, Firm Skills, Access (email whitelists), Settings. |
| `workspace/shellPage.tsx` | Workspace shell (`renderShell`), `shellPage` dual-mode wrapper, `workspaceShellChat`, `workspaceShellLanding`. |
| `workspace/api/` | Workspace data CRUD, upload, export/import, download, decrypt (session-gated). |
| `workflows/workspacePanel.tsx` | Workflows board (partial) — grouped workflow cards, right-rail "awaiting/audit" cards, workspace-chat and workflow modals + build handlers, reset/copy/group/reorder mutations. |
| `workflows/workflowView.tsx` | Single workflow view partial (`/app/view/:id`). |
| `workflows/workflowRun.tsx` | Ephemeral workflow run partial (`/app/run/:id`) — transient session, SSE-streamed. |
| `workflows/specEditor.tsx` | Two-panel live-workflow + chat edit view (`/app/workflow/:id/edit`). |
| `workflows/wizardPage.tsx` | "Make Workflow" wizard (describe → plan → build). Exports shared `Stepper`/`WizIcon`/`ErrCard` primitives. |
| `workflows/modifyWizard.tsx` | "Modify Workflow" wizard (describe interview → review plan → apply). |
| `workflows/planBuild.tsx` | New-workflow plan/build handlers. |
| `workflows/historyPanel.tsx` | Run history partial (`/app/history/:id`). |
| `workflows/workflowGroupHandlers.ts` | Group reset + within-group reorder mutations. |
| `data/dataPanel.tsx` | Data panel (list/load/paste tabs) + paste handler + edit modal + file list refresh. |
| `data/clearData.tsx` | Clear-all-data mutation. |
| `rules/rulesPanel.tsx` | Rules panel (user rules list), detail view, save/delete. |
| `rules/ruleWizard.tsx` | "Make Rule" wizard (choose → describe interview → review → save). |
| `privacy/privacyPanel.tsx` | Privacy map panel + save. |
| `overview/overviewGlassBox.tsx` | Glass Box + GenUI sub-sections for the overview. |
| `logs/logDetail.tsx` | Standalone LLM log detail (`/app/logs/:logId`). |
| `chatPanel.tsx` | Chat list panel (partial). |
| `sessionView.tsx` | Session loader (partial) — cascades to `/sessions/*`. |
| `workspacesPage.tsx` | Firm "Clients" tab: workspaces list, new/open/delete/save-as modals, disk upload/decrypt. |
| `sharePanel.tsx` | Workspace sharing modal + invite/revoke/open. |
| `settingsPanel.tsx` | Settings panel (appearance, model display, secrets list helper shared with the firm settings view). |
| `deleteHandlers.tsx` | Workflow/session delete + clear mutations. |
| `shellUrls.ts` | URL helpers for shell `hx-push-url` targets. |

### `pages/sessions/` Subpages

All routes here are **partials** loaded into the workspace shell's `#main-panel` via `/app/session` (the standalone `/sessions` page was retired).

| File/Dir | Purpose |
|---|---|
| `router.tsx` | Session route definitions. |
| `chatStream/` | Chat stream: message display, send/build-send, resume/pause/start, status, buttons, approval actions, interactive forms, export, inline audit/post-mortem, composer. |
| `sessionList/deleteSessionHandler.tsx` | Session delete. |
| `formHandler.ts` | Form submission handler. |
| `interactHandler.ts` | Session interaction handler (approve, resume, cancel). |
| `reportHandler.tsx` | Session report handler. |

## Pattern

All UI is server-rendered JSX returned as HTML fragments. HTMX attributes in the HTML tell the browser how to swap content, navigate, and submit forms:

```tsx
import { Hono } from "hono";

const router = new Hono();

router.get("/path", (c) => c.html(<Component />));
router.post("/path", async (c) => { /* mutate via WorkspaceSession */ return c.html(<Updated />); });
```

Client-side interactivity for non-HTMX features lives in `public/js/`:
- `composer.js` — model/mode pickers, voice dictation, TTS, file upload.
- `chatHelpers.js` — session row navigation, textarea auto-expand, chat URL updates.
- `modalHelpers.js` — modal open/close delegation.
- `layoutScripts.js` — `x-database-id` header injection, clipboard helpers.
- `workspaceShell.js` — workspace-shell mobile nav drawer + collapsible nav sections.

## Styling & build

- **Tailwind is precompiled** to `public/css/tailwind.css` (no runtime CDN). Source is `styles/input.css` + `tailwind.config.js` (`darkMode: "class"`, typography plugin, and the `warm`/`ink`/`brand`/`leaf`/`coral`/`sun`/`grape`/`pump` palettes). Regenerate with `bun run build:css`; `bun run build` runs it before `build:exe`.
- **`APP_SECRET` is required** — the server throws at startup if it is unset (no fallback in `session.ts`, `authHandlers.tsx`, or `shared/crypto`).

Layout-review fixes applied: runtime Tailwind CDN → static stylesheet; `HX-Refresh` full reloads → targeted `#main-panel` swaps; `/app/view/:id` + `/app/workflow/:id/edit` are now dual-mode (full shell on direct nav) with the card-menu Edit/Run links as HTMX swaps; removed unused `journalEntry.js`, `chatSuggestions.js`, and `saveWorkspace.js` from the workspace shell.

## Related Modules

- `src/server/index.tsx` — mounts all UI routers on the Hono app.
- `src/chat/` — chat stream calls into the chat orchestrator.
- `src/workspace/` — all UI reads/writes workspace state through WorkspaceSession.
